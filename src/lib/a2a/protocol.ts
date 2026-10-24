import { isImagePart } from "./photos";

// Wire format for A2A (https://a2a-protocol.org), JSON-RPC binding. We speak 1.0 and the older
// 0.3 that many SDKs still send: 1.0 has PascalCase methods ("SendMessage"), parts keyed by
// member ({ text } / { url } / { data }) and enums like "ROLE_AGENT" / "TASK_STATE_COMPLETED";
// 0.3 has "message/send", a `kind` on every object and lowercase enums. Everything is stored in
// the 1.0 shape and converted on the way out.

export type Version = "1.0" | "0.3";

export const ErrorCode = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  EXTENDED_CARD_NOT_CONFIGURED: -32007,
  VERSION_NOT_SUPPORTED: -32009,
} as const;

export class A2AError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

export type Method = "send" | "stream" | "get" | "list" | "cancel" | "push" | "extendedCard";

const METHODS: Record<string, Method> = {
  SendMessage: "send",
  "message/send": "send",
  SendStreamingMessage: "stream",
  "message/stream": "stream",
  SubscribeToTask: "stream",
  "tasks/resubscribe": "stream",
  GetTask: "get",
  "tasks/get": "get",
  ListTasks: "list",
  "tasks/list": "list",
  CancelTask: "cancel",
  "tasks/cancel": "cancel",
  CreateTaskPushNotificationConfig: "push",
  GetTaskPushNotificationConfig: "push",
  ListTaskPushNotificationConfigs: "push",
  DeleteTaskPushNotificationConfig: "push",
  "tasks/pushNotificationConfig/set": "push",
  "tasks/pushNotificationConfig/get": "push",
  "tasks/pushNotificationConfig/list": "push",
  "tasks/pushNotificationConfig/delete": "push",
  GetExtendedAgentCard: "extendedCard",
  "agent/getAuthenticatedExtendedCard": "extendedCard",
};

export function methodOf(name: string): Method | null {
  return METHODS[name] ?? null;
}

/**
 * The version to answer in: the `A2A-Version` header (or query param) if the client sent one,
 * otherwise whatever its method naming implies.
 */
export function versionOf(req: Request, method: string): Version {
  const declared = req.headers.get("a2a-version") ?? new URL(req.url).searchParams.get("A2A-Version");
  if (declared?.trim()) {
    const v = declared.trim();
    if (v.startsWith("1.")) return "1.0";
    if (v.startsWith("0.3") || v.startsWith("0.2")) return "0.3";
    throw new A2AError(ErrorCode.VERSION_NOT_SUPPORTED, `A2A version ${v} isn't supported. Use 1.0 or 0.3.`);
  }
  return method.includes("/") ? "0.3" : "1.0";
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export type InPart =
  | { kind: "text"; text: string }
  | { kind: "file"; url?: string; bytes?: string; mediaType?: string; filename?: string }
  | { kind: "data"; data: unknown };

export type InMessage = {
  messageId: string;
  contextId?: string;
  taskId?: string;
  parts: InPart[];
  metadata?: Record<string, unknown>;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function parsePart(p: unknown): InPart | null {
  if (!isObj(p)) return null;
  if (typeof p.text === "string") return { kind: "text", text: p.text };
  // 1.0 file: { url | raw, mediaType, filename }
  if (typeof p.url === "string" || typeof p.raw === "string") {
    return { kind: "file", url: str(p.url), bytes: str(p.raw), mediaType: str(p.mediaType), filename: str(p.filename) };
  }
  // 0.3 file: { kind: "file", file: { uri | bytes, mimeType, name } }
  if (p.kind === "file" && isObj(p.file)) {
    const f = p.file;
    return { kind: "file", url: str(f.uri), bytes: str(f.bytes), mediaType: str(f.mimeType), filename: str(f.name) };
  }
  if ("data" in p) return { kind: "data", data: p.data };
  return null;
}

/** The `message` of a SendMessage request, in either version's shape. */
export function parseMessage(params: unknown): InMessage {
  const m = isObj(params) ? params.message : undefined;
  if (!isObj(m)) throw new A2AError(ErrorCode.INVALID_PARAMS, "params.message is required.");
  const parts = Array.isArray(m.parts) ? m.parts.map(parsePart).filter((p): p is InPart => !!p) : [];
  if (!parts.length) throw new A2AError(ErrorCode.INVALID_PARAMS, "params.message.parts needs at least one text, file or data part.");
  return {
    messageId: str(m.messageId) ?? crypto.randomUUID(),
    contextId: str(m.contextId),
    taskId: str(m.taskId),
    parts,
    metadata: isObj(m.metadata) ? m.metadata : undefined,
  };
}

/** The inbound message, stored as 1.0. Inline bytes are dropped (we keep our Blob copies). */
export function storedUserMessage(
  m: InMessage,
  contextId: string,
  taskId: string,
  photos: { url: string; mediaType: string }[],
): Json {
  const parts: Json[] = m.parts.flatMap((p): Json[] => {
    if (p.kind === "text") return [{ text: p.text }];
    if (p.kind === "data") return [{ data: p.data }];
    // Images are replaced by our Blob copies below; keep links to anything else.
    if (isImagePart(p) || !p.url || p.bytes) return [];
    return [{ url: p.url, mediaType: p.mediaType, filename: p.filename }];
  });
  for (const p of photos) parts.push({ url: p.url, mediaType: p.mediaType });
  return { messageId: m.messageId, contextId, taskId, role: "ROLE_USER", parts, metadata: m.metadata };
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export type TaskRow = {
  id: string;
  contextId: string;
  state: string;
  history: Json[];
  artifacts: Json[];
  createdAt: Date;
  updatedAt: Date;
};

const STATE_V10: Record<string, string> = {
  completed: "TASK_STATE_COMPLETED",
  failed: "TASK_STATE_FAILED",
  rejected: "TASK_STATE_REJECTED",
};

function partV03(p: Json): Json {
  if (typeof p.text === "string") return { kind: "text", text: p.text, ...(p.metadata ? { metadata: p.metadata } : {}) };
  if (typeof p.url === "string") return { kind: "file", file: { uri: p.url, mimeType: p.mediaType, name: p.filename } };
  return { kind: "data", data: p.data, ...(p.metadata ? { metadata: p.metadata } : {}) };
}

function messageV03(m: Json): Json {
  const parts = Array.isArray(m.parts) ? (m.parts as Json[]).map(partV03) : [];
  return { ...m, kind: "message", role: m.role === "ROLE_AGENT" ? "agent" : "user", parts };
}

/** A task as the client expects it. `historyLength` trims history to the most recent messages. */
export function toTask(row: TaskRow, version: Version, opts: { historyLength?: number; artifacts?: boolean } = {}): Json {
  const history = opts.historyLength === undefined ? row.history : opts.historyLength > 0 ? row.history.slice(-opts.historyLength) : [];
  const reply = row.history.findLast((m) => m.role === "ROLE_AGENT");
  const artifacts = opts.artifacts === false ? undefined : row.artifacts;
  if (version === "1.0") {
    return {
      id: row.id,
      contextId: row.contextId,
      status: { state: STATE_V10[row.state] ?? "TASK_STATE_UNSPECIFIED", message: reply, timestamp: row.updatedAt.toISOString() },
      artifacts,
      history,
    };
  }
  return {
    kind: "task",
    id: row.id,
    contextId: row.contextId,
    status: { state: row.state, message: reply && messageV03(reply), timestamp: row.updatedAt.toISOString() },
    artifacts: artifacts?.map((a) => ({ ...a, parts: ((a.parts as Json[]) ?? []).map(partV03) })),
    history: history.map(messageV03),
  };
}

export function rpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

export function rpcError(id: unknown, err: A2AError) {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: err.code, message: err.message, ...(err.data !== undefined && { data: err.data }) },
  });
}
