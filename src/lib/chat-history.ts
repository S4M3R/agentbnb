import type { UIMessage } from "ai";

// Past conversations, kept in this browser's localStorage. There's no sign-in yet (a person is an
// httpOnly cookie per browser), so the browser is the natural home for them for now.
//
// Everything goes through these functions, so moving chats to the database later is a contained
// change: back listChats/getChat/saveChat/deleteChat with fetches to an /api/chats route and keep
// the CHATS_CHANGED event for the UI. Nothing else reads these keys.
//
// Layout: one small index (`agentbnb:chats`, newest first, what the home lists) and one key per
// chat for its messages (`agentbnb:chat:<id>`), so listing chats never parses every conversation.

export type ChatSummary = {
  id: string;
  /** The first thing the person asked, trimmed. */
  title: string;
  /** Epoch ms of the last change. */
  updatedAt: number;
  /** What happened in it, e.g. "12 stays found · 2 applications". */
  hint?: string;
};

export type StoredChat<M extends UIMessage = UIMessage> = ChatSummary & { messages: M[] };

/** Fired on window whenever the stored chats change, in this tab or another one. */
export const CHATS_CHANGED = "agentbnb:chats-changed";

const INDEX_KEY = "agentbnb:chats";
const chatKey = (id: string) => `agentbnb:chat:${id}`;
const MAX_CHATS = 30;
const MAX_TITLE = 80;
const MAX_TEXT = 20_000;
/** Per chat, serialized. Older turns are dropped past this (the title is kept). */
const MAX_CHAT_BYTES = 400_000;

const available = () => typeof window !== "undefined" && "localStorage" in window;

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

let cache: { raw: string | null; list: ChatSummary[] } = { raw: null, list: [] };

/** Saved chats, newest first. The same array is returned until something changes. */
export function listChats(): ChatSummary[] {
  if (!available()) return EMPTY;
  const raw = window.localStorage.getItem(INDEX_KEY);
  if (raw !== cache.raw) {
    let list: ChatSummary[] = [];
    try {
      list = raw ? (JSON.parse(raw) as ChatSummary[]) : [];
    } catch {}
    cache = { raw, list: Array.isArray(list) ? list : [] };
  }
  return cache.list;
}
const EMPTY: ChatSummary[] = [];

export function getChat<M extends UIMessage = UIMessage>(id: string): StoredChat<M> | null {
  if (!available()) return null;
  const summary = listChats().find((c) => c.id === id);
  const messages = read<M[]>(chatKey(id));
  return summary && Array.isArray(messages) ? { ...summary, messages } : null;
}

/** The chat's title: its first user message, trimmed. */
export function titleFor(messages: UIMessage[]) {
  const text = messages
    .find((m) => m.role === "user")
    ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text;
}

/**
 * What's safe to keep: no inline data: URLs (attachments are uploaded to Blob first, so they're
 * normally plain URLs), capped text, and nothing half-streamed. A tool call still running when the
 * page closed is dropped, unless `pendingOk` says it's one the browser answers (a calendar or map
 * the person can still fill in).
 */
function settle<M extends UIMessage>(messages: M[], pendingOk: (type: string) => boolean): M[] {
  const out: M[] = [];
  for (const m of messages) {
    const parts = m.parts.flatMap((p): M["parts"] => {
      if (p.type === "file" && p.url.startsWith("data:")) return [];
      if (p.type === "text" || p.type === "reasoning")
        return [{ ...p, text: p.text.length > MAX_TEXT ? p.text.slice(0, MAX_TEXT) : p.text, state: "done" }];
      if ("state" in p && (p.type.startsWith("tool-") || p.type === "dynamic-tool")) {
        if (p.state === "input-streaming") return [];
        if (p.state === "input-available" && !pendingOk(p.type)) return [];
      }
      return [p];
    });
    if (parts.some((p) => p.type !== "step-start")) out.push({ ...m, parts });
  }
  return out;
}

function trimToSize<M extends UIMessage>(messages: M[]) {
  let kept = messages;
  let raw = JSON.stringify(kept);
  while (raw.length > MAX_CHAT_BYTES && kept.length > 2) {
    kept = kept.slice(2);
    raw = JSON.stringify(kept);
  }
  return raw.length > MAX_CHAT_BYTES ? null : raw;
}

function writeIndex(list: ChatSummary[]) {
  window.localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

function changed() {
  window.dispatchEvent(new Event(CHATS_CHANGED));
}

/**
 * Save (or update) a chat. Chats without a user message are never stored, and saving the same
 * messages again is a no-op, so it's cheap to call after every turn and on unload. Pass
 * `updatedAt` only to put a chat back as it was (undo).
 */
export function saveChat<M extends UIMessage>(chat: {
  id: string;
  messages: M[];
  title?: string;
  hint?: string;
  updatedAt?: number;
  /** Tool part types that may be saved while waiting for the browser's answer. */
  pendingOk?: (type: string) => boolean;
}) {
  if (!available()) return;
  const messages = settle(chat.messages, chat.pendingOk ?? (() => false));
  const title = chat.title ?? titleFor(messages);
  if (!title || !messages.some((m) => m.role === "user")) return;

  const raw = trimToSize(messages);
  if (!raw) return;
  const list = listChats();
  const prior = list.find((c) => c.id === chat.id);
  if (
    prior &&
    chat.updatedAt == null &&
    prior.title === title &&
    prior.hint === chat.hint &&
    window.localStorage.getItem(chatKey(chat.id)) === raw
  )
    return;

  // Only new messages move a chat up the list; a refreshed title or hint keeps its place.
  const moved = !prior || window.localStorage.getItem(chatKey(chat.id)) !== raw;
  const updatedAt = chat.updatedAt ?? (moved ? Date.now() : prior.updatedAt);
  const summary: ChatSummary = { id: chat.id, title, updatedAt, hint: chat.hint };
  const next = [summary, ...list.filter((c) => c.id !== chat.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  const dropped = next.splice(MAX_CHATS);
  if (dropped.includes(summary)) return; // older than every chat kept

  try {
    window.localStorage.setItem(chatKey(chat.id), raw);
  } catch {
    // Out of space: let the oldest chats go, then try once more.
    const keep = next.filter((c) => c === summary || next.indexOf(c) < Math.floor(next.length / 2));
    dropped.push(...next.filter((c) => !keep.includes(c)));
    next.splice(0, next.length, ...keep);
    dropped.forEach((c) => window.localStorage.removeItem(chatKey(c.id)));
    try {
      window.localStorage.setItem(chatKey(chat.id), raw);
    } catch {
      return;
    }
  }
  dropped.forEach((c) => window.localStorage.removeItem(chatKey(c.id)));
  writeIndex(next);
  changed();
}

export function deleteChat(id: string) {
  if (!available()) return;
  window.localStorage.removeItem(chatKey(id));
  writeIndex(listChats().filter((c) => c.id !== id));
  changed();
}

/** For useSyncExternalStore: notifies on saves in this tab and on changes from other tabs. */
export function subscribeChats(onChange: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key === INDEX_KEY) && onChange();
  window.addEventListener(CHATS_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHATS_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
