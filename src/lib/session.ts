import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "@/db";
import { hashKey, mintKey } from "@/lib/api-auth";

// The web chat has no sign-in yet. Each browser gets a person-held API key in an httpOnly cookie,
// so the chat is just another client holding the person's key. The user row is created lazily,
// the first time they do something that needs one (like listing their place).

const { users, apiKeys } = schema;

const COOKIE = "abnb_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

export type SessionUser = { id: string; name: string; email: string | null };

export type WebSession = {
  /** The person behind this browser, or null if they haven't done anything that needed one. */
  user(): Promise<SessionUser | null>;
  /** The person behind this browser, created on first use. */
  ensureUser(name?: string): Promise<SessionUser>;
};

/** Read (or mint) the session cookie. Call before streaming starts: cookies can't be set after. */
export async function webSession(): Promise<WebSession> {
  const jar = await cookies();
  let key = jar.get(COOKIE)?.value;
  if (!key?.startsWith("abnb_")) {
    key = mintKey().key;
    jar.set(COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_YEAR,
    });
  }
  const keyHash = hashKey(key);
  const prefix = key.slice(0, 12);
  const user = () => userByKeyHash(keyHash);

  async function ensureUser(name?: string) {
    const existing = await user();
    if (existing) {
      if (name && name !== existing.name) {
        await db.update(users).set({ name }).where(eq(users.id, existing.id));
        return { ...existing, name };
      }
      return existing;
    }
    const id = crypto.randomUUID();
    try {
      await db.batch([
        db.insert(users).values({ id, name: name ?? "AgentBnB member" }),
        db.insert(apiKeys).values({ userId: id, keyHash, prefix }),
      ]);
    } catch (err) {
      // Two requests raced to create the same person; the other one won.
      const winner = await user();
      if (winner) return winner;
      throw err;
    }
    return { id, name: name ?? "AgentBnB member", email: null };
  }

  return { user, ensureUser };
}

async function userByKeyHash(keyHash: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));
  return row ?? null;
}

/** The person behind this browser, without minting a cookie. For Server Components, which can't set one. */
export async function currentUser() {
  const key = (await cookies()).get(COOKIE)?.value;
  return key?.startsWith("abnb_") ? userByKeyHash(hashKey(key)) : null;
}
