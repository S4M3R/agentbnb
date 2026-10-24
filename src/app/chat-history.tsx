"use client";

import type { ChatStatus } from "ai";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chatHint, toAttentionRow, toRecentChat } from "@/components/chat/home-adapters";
import type { AgentUIMessage } from "@/lib/agent/tools";
import type { AttentionItem } from "@/lib/attention";
import {
  deleteChat,
  getChat,
  listChats,
  saveChat,
  subscribeChats,
  type ChatSummary,
  type StoredChat,
} from "@/lib/chat-history";
import { useCachedJson, writeCachedJson } from "@/lib/cached-json";

// The home chat's memory: which conversation is open (its id is in the URL as /?c=<id>), saving
// it to this browser after every turn and when the page goes away, and the "Recent conversations"
// and "Needs your attention" data for the home screen.

/** Tools the browser answers (a calendar, a map, a shot list): a saved chat can still be waiting on one. */
const CLIENT_TOOLS = new Set(["tool-askForDates", "tool-askForLocation", "tool-askForPhotos"]);
const pendingOk = (type: string) => CLIENT_TOOLS.has(type);

const NO_CHATS: ChatSummary[] = [];
const UNDO_MS = 6000;

const chatUrl = (id: string | null) => (id ? `/?c=${encodeURIComponent(id)}` : "/");

/**
 * One useChat instance shows every conversation: switching swaps its messages (`onSwitch`), and this
 * hook keeps the conversation's own id, which the server never needs. A new chat gets its id with
 * its first message.
 */
export function useChatHistory({
  enabled,
  messages,
  status,
  stop,
  onSwitch,
}: {
  /** Off for the dev preview, which feeds the chat a fixture. */
  enabled: boolean;
  messages: AgentUIMessage[];
  status: ChatStatus;
  stop: () => void;
  /** Show these messages: another saved conversation, or [] for a new one. */
  onSwitch: (messages: AgentUIMessage[]) => void;
}) {
  const [chatId, setChatId] = useState<string | null>(null);
  const current = useRef({ chatId, messages });
  useEffect(() => {
    current.current = { chatId, messages };
  }, [chatId, messages]);

  const persist = useCallback(() => {
    const { chatId: id, messages: m } = current.current;
    if (enabled && id && m.length) saveChat({ id, messages: m, hint: chatHint(m), pendingOk });
  }, [enabled]);

  // After every finished turn (and each answered calendar or map). Unchanged chats aren't rewritten.
  useEffect(() => {
    if (!enabled || !chatId || !messages.length || (status !== "ready" && status !== "error")) return;
    saveChat({ id: chatId, messages, hint: chatHint(messages), pendingOk });
  }, [enabled, chatId, messages, status]);

  // And mid-turn when the tab is closed or hidden; half-streamed parts are settled on save.
  useEffect(() => {
    const onHidden = () => document.visibilityState === "hidden" && persist();
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [persist]);

  const switchTo = useCallback(
    (id: string | null, next: AgentUIMessage[]) => {
      persist();
      stop();
      current.current = { chatId: id, messages: next };
      setChatId(id);
      onSwitch(next);
    },
    [persist, stop, onSwitch],
  );

  /** Open a saved chat. `push` adds a history entry (a click); following the URL doesn't. */
  const openChat = useCallback(
    (id: string, push = true) => {
      if (id === current.current.chatId) return true;
      const saved = getChat<AgentUIMessage>(id);
      if (!saved) return false;
      switchTo(id, saved.messages);
      if (push) window.history.pushState(null, "", chatUrl(id));
      return true;
    },
    [switchTo],
  );

  const newChat = useCallback(
    (push = true) => {
      if (current.current.messages.length || current.current.chatId) switchTo(null, []);
      if (enabled && push && new URLSearchParams(window.location.search).has("c"))
        window.history.pushState(null, "", "/");
    },
    [enabled, switchTo],
  );

  /** Call as a new chat's first message goes out: it gets its id and URL, in place. */
  const started = useCallback(() => {
    if (!enabled) return;
    let id = current.current.chatId;
    if (!id) {
      id = crypto.randomUUID();
      current.current = { ...current.current, chatId: id };
      setChatId(id);
    }
    window.history.replaceState(null, "", chatUrl(id));
  }, [enabled]);

  // Back, Forward, a reload or a shared /?c= link.
  const onUrl = useCallback(
    (id: string | null) => {
      if (!enabled || id === current.current.chatId) return;
      if (id) {
        if (!openChat(id, false)) window.history.replaceState(null, "", chatUrl(current.current.chatId)); // deleted, or another browser's
      } else newChat(false);
    },
    [enabled, openChat, newChat],
  );

  const stored = useSyncExternalStore(subscribeChats, listChats, () => NO_CHATS);
  const [undo, setUndo] = useState<StoredChat | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const remove = useCallback((id: string) => {
    setUndo(getChat(id));
    deleteChat(id);
  }, []);

  const restore = useCallback(() => {
    if (undo) saveChat(undo);
    setUndo(null);
  }, [undo]);

  const now = useNow(stored);
  return {
    chats: enabled ? stored.map((c) => toRecentChat(c, now)) : [],
    undo: undo && { title: undo.title, onUndo: restore },
    openChat,
    newChat,
    deleteChat: remove,
    started,
    /** Render once; follows the ?c= in the URL. */
    urlWatcher: enabled ? (
      <Suspense fallback={null}>
        <ChatUrl onChange={onUrl} />
      </Suspense>
    ) : null,
  };
}

/** The time "2h ago" is measured from, refreshed whenever the list changes and once a minute. */
function useNow(dep: unknown) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [dep]);
  return now || undefined;
}

/** Reads ?c= (inside Suspense, as useSearchParams needs on a prerendered page) and reports changes. */
function ChatUrl({ onChange }: { onChange: (id: string | null) => void }) {
  const id = useSearchParams().get("c");
  // Only a change of URL counts, not a new callback.
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);
  useEffect(() => {
    handler.current(id);
  }, [id]);
  return null;
}

/**
 * "Needs your attention", loaded when the home shows and refreshed when the tab regains focus
 * (and every minute while it's visible), like the header's unread badge.
 */
const NO_ITEMS: AttentionItem[] = [];

export function useAttention(active: boolean) {
  // Last known items show as soon as the home hydrates (see cached-json); the fetch refreshes them.
  const items = useCachedJson<AttentionItem[]>("abnb:attention") ?? NO_ITEMS;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    async function load() {
      const res = await fetch("/api/attention", { cache: "no-store" }).catch(() => null);
      if (res?.ok && !stopped) writeCachedJson("abnb:attention", (await res.json()).items ?? []);
    }
    const onVisible = () => document.visibilityState === "visible" && load();
    load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(onVisible, 60_000);
    return () => {
      stopped = true;
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [active]);
  const now = useNow(items);
  return items.map((i) => toAttentionRow(i, now));
}
