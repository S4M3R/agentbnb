import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { sourceForUrl } from "@/lib/source-logos";

// The Keychain: each person's logins on other sites, so the browser agent can sign in (or sign up)
// for them without asking every time.
//
// Security rules (see CLAUDE.md):
// - Passwords are encrypted at rest with AES-256-GCM: a random 12-byte IV per entry, a 32-byte key
//   from KEYCHAIN_KEY (base64), and the row's user id + site as additional data, so a ciphertext
//   copied to another row or person doesn't decrypt.
// - Plaintext only exists in memory during a browser run (or the one "Reveal" click for accounts
//   the agent created). It never goes into prompts, tool results, events, logs or metadata: the
//   browser agent hands it to Stagehand as an `act()` variable, which the model only sees as
//   %password%.
// - This module is the only place that encrypts or decrypts.

const { keychainEntries: entries, keychainSettings: settings, userSourceAccounts, sources } = schema;

export type CreatedBy = (typeof schema.keychainCreatedBy.enumValues)[number];
export type EntryStatus = (typeof schema.keychainStatus.enumValues)[number];

export class KeychainError extends Error {}

const VERSION = "v1";

function key() {
  const raw = process.env.KEYCHAIN_KEY;
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw new KeychainError("The Keychain isn't set up (KEYCHAIN_KEY must be 32 bytes, base64).");
  return k;
}

const aad = (userId: string, site: string) => Buffer.from(`keychain:${userId}:${site}`, "utf8");

/** Encrypt a secret for one person's entry on one site. */
export function encryptSecret(plaintext: string, userId: string, site: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(userId, site));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** Decrypt a secret. Throws if it was tampered with or belongs to another person or site. */
export function decryptSecret(ciphertext: string, userId: string, site: string) {
  const [version, iv, tag, ct] = ciphertext.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new KeychainError("Unknown Keychain format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(aad(userId, site));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** A strong random password that passes the usual site rules (upper, lower, digit, symbol). */
export function generatePassword(length = 20) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!#$%*+-=?@_"];
  const all = sets.join("");
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export type Site = { site: string; sourceId: string | null; domain: string | null };

/**
 * The Keychain key for a site: a source id we know ("workaway"), or the bare domain of any other
 * website ("example.com"). Accepts a source id, URL or domain. Null if it isn't a website.
 */
export async function resolveSite(input: string): Promise<Site | null> {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  const [source] = await db.select({ id: sources.id }).from(sources).where(eq(sources.id, value));
  if (source) return { site: source.id, sourceId: source.id, domain: null };

  let host: string;
  try {
    host = new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  const known = sourceForUrl(host);
  if (known) {
    const [s] = await db.select({ id: sources.id }).from(sources).where(eq(sources.id, known));
    if (s) return { site: s.id, sourceId: s.id, domain: null };
  }
  return { site: host, sourceId: null, domain: host };
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export type Credential = {
  id: string;
  site: string;
  login: string;
  /** Plaintext. Keep it in memory for the run; never log it or return it to the model. */
  password: string;
  createdBy: CreatedBy;
  status: EntryStatus;
};

/** The person's saved login for a site, decrypted, or null. Server-side runs only. */
export async function getCredential(userId: string, site: string): Promise<Credential | null> {
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), eq(entries.site, site)));
  if (!row) return null;
  return {
    id: row.id,
    site: row.site,
    login: row.login,
    password: decryptSecret(row.secretCiphertext, userId, row.site),
    createdBy: row.createdBy,
    status: row.status,
  };
}

/** Whether there's a login for the site, and how it's doing, without decrypting anything. */
export async function entryState(userId: string, site: string) {
  const [row] = await db
    .select({ id: entries.id, status: entries.status, createdBy: entries.createdBy, updatedAt: entries.updatedAt })
    .from(entries)
    .where(and(eq(entries.userId, userId), eq(entries.site, site)));
  return row ?? null;
}

/**
 * Save (or replace) the login for a site. A blank `password` on an existing entry keeps the old one,
 * so the person can fix the login or notes without retyping it.
 */
export async function saveCredential(input: {
  userId: string;
  site: Site;
  login: string;
  password?: string;
  createdBy: CreatedBy;
  status?: EntryStatus;
  notes?: string | null;
}) {
  const { userId, site } = input;
  const login = input.login.trim();
  if (!login) throw new KeychainError("Add the email or username you log in with.");
  const existing = await entryState(userId, site.site);
  if (!input.password && !existing) throw new KeychainError("Add the password.");

  const values = {
    login,
    ...(input.password && { secretCiphertext: encryptSecret(input.password, userId, site.site) }),
    createdBy: input.createdBy,
    status: input.status ?? "active",
    ...(input.notes !== undefined && { notes: input.notes?.trim() || null }),
  };
  const [row] = await db
    .insert(entries)
    .values({ userId, site: site.site, sourceId: site.sourceId, domain: site.domain, secretCiphertext: "", ...values })
    .onConflictDoUpdate({ target: [entries.userId, entries.site], set: { ...values, updatedAt: new Date() } })
    .returning({ id: entries.id });
  return row.id;
}

/** After the agent used a login: when, and whether the site took it. */
export async function markUsed(userId: string, site: string, status: EntryStatus) {
  await db
    .update(entries)
    .set({ status, lastUsedAt: new Date() })
    .where(and(eq(entries.userId, userId), eq(entries.site, site)));
}

export type KeychainRow = {
  id: string;
  site: string;
  sourceId: string | null;
  name: string;
  login: string;
  createdBy: CreatedBy;
  status: EntryStatus;
  notes: string | null;
  lastUsedAt: Date | null;
  updatedAt: Date;
};

/** Every login the person has, without secrets. */
export async function listEntries(userId: string): Promise<KeychainRow[]> {
  const rows = await db
    .select({
      id: entries.id,
      site: entries.site,
      sourceId: entries.sourceId,
      sourceName: sources.name,
      login: entries.login,
      createdBy: entries.createdBy,
      status: entries.status,
      notes: entries.notes,
      lastUsedAt: entries.lastUsedAt,
      updatedAt: entries.updatedAt,
    })
    .from(entries)
    .leftJoin(sources, eq(sources.id, entries.sourceId))
    .where(eq(entries.userId, userId))
    .orderBy(desc(entries.updatedAt));
  return rows.map(({ sourceName, ...r }) => ({ ...r, name: sourceName ?? r.site }));
}

export async function deleteEntry(userId: string, id: string) {
  await db.delete(entries).where(and(eq(entries.userId, userId), eq(entries.id, id)));
}

/**
 * The password of an account the agent created, so the person can log in themself. Only for
 * `created_by: agent`: what the person typed in, they already know.
 */
export async function revealAgentPassword(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), eq(entries.id, id)));
  if (!row || row.createdBy !== "agent") throw new KeychainError("Only passwords your agent created can be shown.");
  return decryptSecret(row.secretCiphertext, userId, row.site);
}

// ---------------------------------------------------------------------------
// Settings and browser sessions
// ---------------------------------------------------------------------------

export async function getSettings(userId: string) {
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  return { allowSignUp: row?.allowSignUp ?? true };
}

export async function setAllowSignUp(userId: string, allowSignUp: boolean) {
  await db
    .insert(settings)
    .values({ userId, allowSignUp })
    .onConflictDoUpdate({ target: settings.userId, set: { allowSignUp, updatedAt: new Date() } });
}

/**
 * Sites the person is signed in to through a saved browser profile (cookies in a Browserbase
 * context) but has no Keychain login for.
 */
export async function browserSessions(userId: string) {
  const rows = await db
    .select({
      sourceId: userSourceAccounts.sourceId,
      name: sources.name,
      externalUsername: userSourceAccounts.externalUsername,
      connectedAt: userSourceAccounts.connectedAt,
    })
    .from(userSourceAccounts)
    .innerJoin(sources, eq(sources.id, userSourceAccounts.sourceId))
    .where(
      and(
        eq(userSourceAccounts.userId, userId),
        eq(userSourceAccounts.status, "connected"),
        isNotNull(userSourceAccounts.credentialRef),
      ),
    )
    .orderBy(desc(userSourceAccounts.connectedAt));
  const saved = new Set((await listEntries(userId)).map((e) => e.site));
  return rows.filter((r) => !saved.has(r.sourceId));
}

/** Forget a saved browser session: the next run starts logged out. Returns the context to delete. */
export async function forgetSession(userId: string, sourceId: string) {
  const [row] = await db
    .delete(userSourceAccounts)
    .where(and(eq(userSourceAccounts.userId, userId), eq(userSourceAccounts.sourceId, sourceId)))
    .returning({ contextId: userSourceAccounts.credentialRef });
  return row?.contextId ?? null;
}
