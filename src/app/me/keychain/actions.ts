"use server";

import Browserbase from "@browserbasehq/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { latestAsk } from "@/lib/access";
import * as keychain from "@/lib/keychain";
import { ProfileError, ProfileInput, updateProfile } from "@/lib/profile";
import { webSession } from "@/lib/session";

// The Keychain page and the "save your login" forms on a waiting application. Passwords come in
// as arguments, are encrypted by src/lib/keychain.ts and are never logged or echoed back (except
// the one explicit Reveal of a password the agent generated). A password the person generated in
// their browser ("Generate a secure password") arrives here the same way, with `generated: true`.

export type Result = { ok: true } | { ok: false; error: string; field?: string };

const { applications, applicationEvents: events, listings } = schema;

const Login = z.string().trim().min(1, "Add the email or username you log in with.").max(200);
const Password = z.string().max(500);
const Notes = z.string().trim().max(500).optional();

/** Never log the error object itself: it could carry the arguments. */
function fail(err: unknown, fallback = "Couldn't save that. Try again."): Result {
  if (err instanceof keychain.KeychainError) return { ok: false, error: err.message };
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0].message, field: String(err.issues[0].path[0] ?? "") };
  console.error("keychain action failed:", err instanceof Error ? err.name : "unknown");
  return { ok: false, error: fallback };
}

async function me() {
  return (await webSession()).ensureUser();
}

/** Add or edit a login from the Keychain page. A blank password on edit keeps the saved one. */
export async function saveLogin(input: {
  site: string;
  login: string;
  password: string;
  notes?: string;
  generated?: boolean;
}): Promise<Result> {
  try {
    const user = await me();
    const site = await keychain.resolveSite(z.string().max(300).parse(input.site));
    if (!site) return { ok: false, error: "That doesn't look like a website. Try a URL like example.com.", field: "site" };
    const password = Password.parse(input.password);
    await keychain.saveCredential({
      userId: user.id,
      site,
      login: Login.parse(input.login),
      password: password || undefined,
      createdBy: "person",
      notes: Notes.parse(input.notes) ?? null,
      generated: input.generated === true,
    });
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteLogin(id: string): Promise<Result> {
  try {
    const user = await me();
    await keychain.deleteEntry(user.id, z.uuid().parse(id));
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err, "Couldn't delete it. Try again.");
  }
}

/** Show the password of an account the agent created, once, after an explicit click. */
export async function revealPassword(id: string): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  try {
    const user = await me();
    return { ok: true, password: await keychain.revealAgentPassword(user.id, z.uuid().parse(id)) };
  } catch (err) {
    const r = fail(err, "Couldn't show it. Try again.");
    return { ok: false, error: r.ok ? "" : r.error };
  }
}

export async function setAllowSignUp(on: boolean): Promise<Result> {
  try {
    const user = await me();
    await keychain.setAllowSignUp(user.id, z.boolean().parse(on));
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** The email the agent signs up with: the one on their profile. */
export async function saveSignUpEmail(email: string): Promise<Result> {
  const parsed = ProfileInput.shape.email.safeParse(email);
  if (!parsed.success || !parsed.data) return { ok: false, error: "That doesn't look like an email address.", field: "email" };
  const user = await me();
  try {
    await updateProfile(user.id, { email: parsed.data });
  } catch (err) {
    if (err instanceof ProfileError) return { ok: false, error: err.message, field: "email" };
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/**
 * What a login form fills in for a site: the login saved in their Keychain for it, or else the email
 * on their profile. Never a password. Null when there's neither (or no member yet).
 */
export async function loginPrefill(site: string | null): Promise<string | null> {
  try {
    const user = await (await webSession()).user();
    if (!user) return null;
    const resolved = site ? await keychain.resolveSite(z.string().max(300).parse(site)) : null;
    if (resolved) {
      const [entry] = await db
        .select({ login: schema.keychainEntries.login })
        .from(schema.keychainEntries)
        .where(and(eq(schema.keychainEntries.userId, user.id), eq(schema.keychainEntries.site, resolved.site)));
      if (entry) return entry.login;
    }
    const [row] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, user.id));
    return row?.email ?? null;
  } catch {
    return null;
  }
}

/** Forget a saved browser session: delete the row and, best effort, the Browserbase context. */
export async function forgetBrowserSession(sourceId: string): Promise<Result> {
  try {
    const user = await me();
    const contextId = await keychain.forgetSession(user.id, z.string().min(1).max(100).parse(sourceId));
    if (contextId && process.env.BROWSERBASE_API_KEY) {
      await new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY }).contexts.delete(contextId).catch(() => {});
    }
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err, "Couldn't forget it. Try again.");
  }
}

// ---------------------------------------------------------------------------
// Answering a waiting application
// ---------------------------------------------------------------------------

/** The guest's application that's waiting on `kind`, and its site. */
async function waitingApplication(userId: string, applicationId: string, kind: "credentials" | "email") {
  const id = z.uuid().parse(applicationId);
  const [row] = await db
    .select({ userId: applications.userId, status: applications.status, sourceId: listings.sourceId })
    .from(applications)
    .innerJoin(listings, eq(listings.id, applications.listingId))
    .where(eq(applications.id, id));
  if (row?.userId !== userId) throw new keychain.KeychainError("No such application.");
  const timeline = await db
    .select({ kind: events.kind, data: events.data })
    .from(events)
    .where(and(eq(events.applicationId, id), eq(events.kind, "status")))
    .orderBy(events.createdAt);
  const ask = latestAsk(row.status, timeline);
  if (ask?.kind !== kind) throw new keychain.KeychainError("Your agent isn't waiting for this anymore.");
  return { id, sourceId: ask.site ?? row.sourceId };
}

/** Hand the application back to the browser agent, like tapping Continue. */
async function resume(id: string, message: string) {
  await db
    .update(applications)
    .set({ userActedAt: new Date(), status: "sending", statusMessage: message })
    .where(eq(applications.id, id));
}

/**
 * "Save and continue" on an application waiting for a login: encrypt and store it, then let the
 * run sign in with it. The client kicks a new run in case the browser already closed.
 */
export async function saveLoginAndContinue(
  applicationId: string,
  input: { login: string; password: string; generated?: boolean },
): Promise<Result> {
  try {
    const user = await me();
    const { id, sourceId } = await waitingApplication(user.id, applicationId, "credentials");
    const site = await keychain.resolveSite(sourceId);
    if (!site) throw new keychain.KeychainError("Unknown site.");
    const password = Password.parse(input.password);
    if (!password) return { ok: false, error: "Add the password.", field: "password" };
    await keychain.saveCredential({
      userId: user.id,
      site,
      login: Login.parse(input.login),
      password,
      createdBy: "person",
      generated: input.generated === true,
    });
    await resume(id, "Thanks! Signing you in…");
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** The agent needs an email to create an account: save it on the profile and continue. */
export async function saveEmailAndContinue(applicationId: string, email: string): Promise<Result> {
  try {
    const user = await me();
    const { id } = await waitingApplication(user.id, applicationId, "email");
    const saved = await saveSignUpEmail(email);
    if (!saved.ok) return saved;
    await resume(id, "Thanks! Creating your account…");
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// The chat's askForLogin card
// ---------------------------------------------------------------------------

export type ChatLoginResult =
  | { ok: true; site: string; login: string; resumed: string[] }
  | { ok: false; error: string; field?: string };

/**
 * "Save and continue" on the chat's askForLogin card: encrypt the login into the Keychain, and hand
 * any application waiting for this site's login back to the browser agent (the client kicks those
 * runs). Returns the site and login for the model, never the password.
 */
export async function saveChatLogin(input: {
  site: string;
  login: string;
  password: string;
  generated?: boolean;
}): Promise<ChatLoginResult> {
  try {
    const user = await me();
    const site = await keychain.resolveSite(z.string().max(300).parse(input.site));
    if (!site) return { ok: false, error: "That doesn't look like a website.", field: "site" };
    const password = Password.parse(input.password);
    if (!password) return { ok: false, error: "Add the password.", field: "password" };
    const login = Login.parse(input.login);
    await keychain.saveCredential({
      userId: user.id,
      site,
      login,
      password,
      createdBy: "person",
      generated: input.generated === true,
    });

    const resumed: string[] = [];
    for (const app of await waitingForLogin(user.id)) {
      if (app.site !== site.site) continue;
      await resume(app.id, "Thanks! Signing you in…");
      resumed.push(app.id);
    }
    refresh();
    return { ok: true, site: site.site, login: login.trim(), resumed };
  } catch (err) {
    const r = fail(err);
    return r.ok ? { ok: false, error: "Couldn't save that. Try again." } : r;
  }
}

/** The person's applications waiting for a login, with the Keychain site each one needs. */
async function waitingForLogin(userId: string) {
  const rows = await db
    .select({ id: applications.id, status: applications.status, sourceId: listings.sourceId })
    .from(applications)
    .innerJoin(listings, eq(listings.id, applications.listingId))
    .where(and(eq(applications.userId, userId), eq(applications.status, "needs_user")));
  if (!rows.length) return [];
  const timeline = await db
    .select({ applicationId: events.applicationId, kind: events.kind, data: events.data })
    .from(events)
    .where(and(inArray(events.applicationId, rows.map((r) => r.id)), eq(events.kind, "status")))
    .orderBy(events.createdAt);
  return rows.flatMap((r) => {
    const ask = latestAsk(r.status, timeline.filter((e) => e.applicationId === r.id));
    return ask?.kind === "credentials" ? [{ id: r.id, site: ask.site ?? r.sourceId }] : [];
  });
}
