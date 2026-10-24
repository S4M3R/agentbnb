import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";

// API keys for the public API (/api/v1). A key belongs to a person and is held either by that
// person or by one of their agents (Instinct, Dot, Muse, ...). Agents can register themselves
// and their person in one call; there's no email verification yet, so an email can only be
// registered once and further keys come from an existing key.

const { users, agents, apiKeys } = schema;

const KEY_PREFIX = "abnb_";
const AGENT_NAMES = { instinct: "Instinct", dot: "Dot", muse: "Muse" } as const;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Error body for the public API: branch on `code`, show `message`. */
export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) return apiError(err.status, err.code, err.message);
  throw err;
}

export function unauthenticated() {
  return apiError(
    401,
    "UNAUTHENTICATED",
    "Send `Authorization: Bearer <api key>`. Get a key with POST /api/v1/register.",
  );
}

/** Parse a JSON body against a schema, turning bad input into a 400. */
export async function parseBody<T extends z.ZodType>(req: Request, shape: T): Promise<z.infer<T>> {
  const body = await req.json().catch(() => undefined);
  const parsed = shape.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "INVALID_BODY", z.prettifyError(parsed.error));
  return parsed.data;
}

const AgentInput = z
  .object({
    kind: z.enum(schema.agentKind.enumValues),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .refine((a) => a.kind !== "other" || a.name, {
    message: 'name is required when kind is "other"',
    path: ["name"],
  });

type AgentInput = z.infer<typeof AgentInput>;

export const Registration = z.object({
  person: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.email().transform((e) => e.trim().toLowerCase()),
    homeCity: z.string().trim().max(120).optional(),
    bio: z.string().trim().max(2000).optional(),
  }),
  /** Omit when the person registers themself. */
  agent: AgentInput.optional(),
});

export const NewKey = z.object({
  /** Omit for a key the person holds themself. */
  agent: AgentInput.optional(),
});

function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function mintKey() {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, keyHash: hashKey(key), prefix: key.slice(0, 12) };
}

function agentName(agent: AgentInput) {
  return agent.name ?? AGENT_NAMES[agent.kind as keyof typeof AGENT_NAMES];
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export type Principal = {
  keyId: string;
  user: { id: string; name: string; email: string };
  /** Null when the person holds the key themself. */
  agent: { id: string; kind: (typeof schema.agentKind.enumValues)[number]; name: string } | null;
};

/** Resolve the bearer key on a request, or null if it's missing, unknown or revoked. */
export async function authenticate(req: Request): Promise<Principal | null> {
  const key = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key?.startsWith(KEY_PREFIX)) return null;

  const [row] = await db
    .select({
      keyId: apiKeys.id,
      lastUsedAt: apiKeys.lastUsedAt,
      user: { id: users.id, name: users.name, email: users.email },
      agent: { id: agents.id, kind: agents.kind, name: agents.name },
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .leftJoin(agents, eq(agents.id, apiKeys.agentId))
    .where(and(eq(apiKeys.keyHash, hashKey(key)), isNull(apiKeys.revokedAt)));
  if (!row) return null;

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    after(() => db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.keyId)));
  }
  return { keyId: row.keyId, user: row.user, agent: row.agent };
}

/** Create a person, optionally the agent registering them, and the first API key. */
export async function register(input: z.infer<typeof Registration>) {
  const { person } = input;
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${person.email}`);
  if (taken) {
    throw new ApiError(
      409,
      "EMAIL_TAKEN",
      "This email is already registered. Ask the person for a key, or have one of their existing keys call POST /api/v1/keys.",
    );
  }

  const user = { id: randomUUID(), ...person };
  const agent = input.agent && {
    id: randomUUID(),
    userId: user.id,
    kind: input.agent.kind,
    name: agentName(input.agent),
  };
  const { key, ...stored } = mintKey();
  const keyRow = { id: randomUUID(), userId: user.id, agentId: agent?.id ?? null, ...stored };

  try {
    const insertUser = db.insert(users).values(user);
    const insertKey = db.insert(apiKeys).values(keyRow);
    await (agent
      ? db.batch([insertUser, db.insert(agents).values(agent), insertKey])
      : db.batch([insertUser, insertKey]));
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "EMAIL_TAKEN", "This email is already registered.");
    throw err;
  }

  return {
    apiKey: key,
    key: { id: keyRow.id, prefix: keyRow.prefix },
    user: { id: user.id, name: user.name, email: user.email },
    agent: agent ? { id: agent.id, kind: agent.kind, name: agent.name } : null,
  };
}

/** Issue another key for the same person, e.g. Instinct connecting Muse. */
export async function createKey(principal: Principal, input: z.infer<typeof NewKey>) {
  if (!input.agent && principal.agent) {
    throw new ApiError(
      403,
      "PERSON_KEY_REQUIRED",
      "Agent keys can only create keys for agents. Pass `agent: { kind, name }`.",
    );
  }

  let agent: Principal["agent"] = null;
  if (input.agent) {
    [agent] = await db
      .insert(agents)
      .values({ userId: principal.user.id, kind: input.agent.kind, name: agentName(input.agent) })
      .onConflictDoUpdate({
        target: [agents.userId, agents.kind, agents.name],
        set: { updatedAt: new Date() },
      })
      .returning({ id: agents.id, kind: agents.kind, name: agents.name });
  }

  const { key, ...stored } = mintKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ userId: principal.user.id, agentId: agent?.id ?? null, ...stored })
    .returning({ id: apiKeys.id, prefix: apiKeys.prefix });

  return { apiKey: key, key: row, agent };
}

/** Active keys for the person behind `principal`. */
export async function listKeys(principal: Principal) {
  return db
    .select({
      id: apiKeys.id,
      prefix: apiKeys.prefix,
      agent: { id: agents.id, kind: agents.kind, name: agents.name },
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .leftJoin(agents, eq(agents.id, apiKeys.agentId))
    .where(and(eq(apiKeys.userId, principal.user.id), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

/** The person's own keys can revoke any of their keys; an agent key can only revoke itself. */
export async function revokeKey(principal: Principal, keyId: string) {
  if (principal.agent && keyId !== principal.keyId) {
    throw new ApiError(403, "PERSON_KEY_REQUIRED", "Agent keys can only revoke themselves.");
  }
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(apiKeys.id, keyId), eq(apiKeys.userId, principal.user.id), isNull(apiKeys.revokedAt)),
    )
    .returning({ id: apiKeys.id });
  if (!row) throw new ApiError(404, "KEY_NOT_FOUND", "No active key with that id.");
  return row;
}
