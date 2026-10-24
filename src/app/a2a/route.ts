import { randomUUID } from "node:crypto";
import { and, count, desc, eq, isNull, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadHistory, runTurn, type SharedLink } from "@/lib/a2a/agent";
import { isImagePart, storePhotos } from "@/lib/a2a/photos";
import {
  A2AError,
  ErrorCode,
  methodOf,
  parseMessage,
  rpcError,
  rpcResult,
  storedUserMessage,
  toTask,
  type TaskRow,
  type Version,
  versionOf,
} from "@/lib/a2a/protocol";
import { authenticate, type Principal } from "@/lib/api-auth";

// A2A endpoint (JSON-RPC). Personal agents like Instinct talk to AgentBnB here in plain language;
// we answer synchronously with a completed task whose reply carries a short link for iMessage.
// Discovery: /.well-known/agent-card.json. Same API keys as /api/v1, and optional: without one,
// callers can search but not host.

export const maxDuration = 120;

const { a2aTasks } = schema;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, unknown>;

function ownedBy(caller: Principal | null): SQL {
  return caller ? eq(a2aTasks.userId, caller.user.id) : isNull(a2aTasks.userId);
}

async function findTask(id: unknown, caller: Principal | null) {
  if (typeof id !== "string" || !UUID.test(id)) throw new A2AError(ErrorCode.TASK_NOT_FOUND, "Task not found.");
  const [row] = await db.select().from(a2aTasks).where(and(eq(a2aTasks.id, id), ownedBy(caller)));
  if (!row) throw new A2AError(ErrorCode.TASK_NOT_FOUND, "Task not found.");
  return row as TaskRow;
}

function linkArtifact(link: SharedLink) {
  return {
    artifactId: link.id,
    name: link.title,
    description:
      "A page with the listings as cards. Send the URL to the person as its own message: in iMessage it unfolds " +
      "into a preview with photos.",
    parts: [
      { text: link.url },
      {
        data: { kind: "agentbnb.link", url: link.url, title: link.title, listings: link.listings, image: `${link.url}/opengraph-image` },
        mediaType: "application/json",
      },
    ],
  };
}

async function sendMessage(req: Request, params: Params, caller: Principal | null, version: Version) {
  const input = parseMessage(params);
  const contextId = input.contextId ?? randomUUID();
  const taskId = randomUUID();
  const origin = new URL(req.url).origin;

  const [history, { photos, skipped }] = await Promise.all([
    loadHistory(contextId, caller),
    caller ? storePhotos(input.parts) : { photos: [], skipped: 0 },
  ]);
  const anonymousPhotos = !caller && input.parts.some(isImagePart);

  let state = "completed";
  let text: string;
  let links: SharedLink[] = [];
  let modelMessages: unknown[] = [];
  try {
    const turn = await runTurn({ caller, origin, input, photos, skippedPhotos: skipped, history });
    ({ text, links, modelMessages } = turn);
    if (anonymousPhotos) text += "\n(Photos need an AgentBnB account: connect one with an API key to list a place.)";
  } catch (err) {
    console.error("a2a turn failed", err);
    state = "failed";
    text = "Sorry, something went wrong on my side. Try again in a moment.";
  }

  const reply = {
    messageId: randomUUID(),
    contextId,
    taskId,
    role: "ROLE_AGENT",
    parts: [{ text }],
    ...(links.length && { metadata: { links: links.map((l) => l.url) } }),
  };
  const [row] = await db
    .insert(a2aTasks)
    .values({
      id: taskId,
      contextId,
      userId: caller?.user.id ?? null,
      agentId: caller?.agent?.id ?? null,
      state,
      history: [storedUserMessage(input, contextId, taskId, photos), reply],
      artifacts: links.map(linkArtifact),
      modelMessages,
    })
    .returning();

  const config = (params.configuration ?? {}) as { historyLength?: number };
  const task = toTask(row as TaskRow, version, { historyLength: config.historyLength });
  return version === "1.0" ? { task } : task;
}

async function listTasks(params: Params, caller: Principal | null, version: Version) {
  const contextId = typeof params.contextId === "string" ? params.contextId : undefined;
  if (!caller && !contextId) throw new A2AError(ErrorCode.INVALID_PARAMS, "Send contextId, or authenticate to list all your tasks.");
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 50));
  const offset = Math.max(0, Number(params.pageToken) || 0);
  const where = and(ownedBy(caller), contextId ? eq(a2aTasks.contextId, contextId) : undefined);

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(a2aTasks).where(where).orderBy(desc(a2aTasks.updatedAt)).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(a2aTasks).where(where),
  ]);
  const historyLength = typeof params.historyLength === "number" ? params.historyLength : 0;
  return {
    tasks: rows.map((r) => toTask(r as TaskRow, version, { historyLength, artifacts: params.includeArtifacts === true })),
    nextPageToken: offset + rows.length < total ? String(offset + rows.length) : "",
    pageSize,
    totalSize: total,
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return rpcError(null, new A2AError(ErrorCode.PARSE, "Body isn't valid JSON."));
  const rpc = body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (rpc?.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return rpcError(rpc?.id, new A2AError(ErrorCode.INVALID_REQUEST, 'Expected a JSON-RPC 2.0 request: { "jsonrpc": "2.0", "id", "method", "params" }.'));
  }

  const caller = await authenticate(req);
  if (!caller && req.headers.has("authorization")) {
    // A bad key shouldn't quietly downgrade to anonymous: the agent would think it's connected.
    return Response.json(
      { jsonrpc: "2.0", id: rpc.id ?? null, error: { code: ErrorCode.INVALID_REQUEST, message: "Unknown or revoked API key." } },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="agentbnb"' } },
    );
  }

  try {
    const method = methodOf(rpc.method);
    if (!method) throw new A2AError(ErrorCode.METHOD_NOT_FOUND, `Unknown method ${rpc.method}.`);
    const version = versionOf(req, rpc.method);
    const params = (rpc.params && typeof rpc.params === "object" ? rpc.params : {}) as Params;

    switch (method) {
      case "send":
        return rpcResult(rpc.id, await sendMessage(req, params, caller, version));
      case "get": {
        const row = await findTask(params.id, caller);
        const historyLength = typeof params.historyLength === "number" ? params.historyLength : undefined;
        return rpcResult(rpc.id, toTask(row, version, { historyLength }));
      }
      case "list":
        return rpcResult(rpc.id, await listTasks(params, caller, version));
      case "cancel":
        await findTask(params.id, caller);
        throw new A2AError(ErrorCode.TASK_NOT_CANCELABLE, "Tasks finish before we reply, so there's nothing to cancel.");
      case "stream":
        throw new A2AError(ErrorCode.UNSUPPORTED_OPERATION, "Streaming isn't supported; use SendMessage.");
      case "push":
        throw new A2AError(ErrorCode.PUSH_NOT_SUPPORTED, "Push notifications aren't supported.");
      case "extendedCard":
        throw new A2AError(ErrorCode.EXTENDED_CARD_NOT_CONFIGURED, "There's no extended agent card.");
    }
  } catch (err) {
    if (err instanceof A2AError) return rpcError(rpc.id, err);
    console.error("a2a request failed", err);
    return rpcError(rpc.id, new A2AError(ErrorCode.INTERNAL, "Internal error."));
  }
}
