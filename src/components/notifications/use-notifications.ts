"use client";

import { useCallback, useEffect } from "react";
import { useCachedJson, writeCachedJson } from "@/lib/cached-json";
import { NOTIFICATIONS_CHANGED } from "./use-push";

// The header bell's data: the newest notifications and the unread count from GET /api/notifications.
// Refreshes on focus, every minute while visible, when a push arrives (public/sw.js posts a message
// to open tabs) and after a test. The last answer shows straight away (see cached-json).

export type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  /** ISO time. */
  at: string;
};

type Inbox = { items: NotificationItem[]; unread: number; worthHearing: boolean };

const KEY = "abnb:notifications";
const EMPTY: Inbox = { items: [], unread: 0, worthHearing: false };

async function load() {
  const res = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return;
  const inbox = (await res.json()) as Inbox;
  writeCachedJson(KEY, inbox);
}

async function markRead(ids?: string[]) {
  await fetch("/api/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  }).catch(() => null);
  // The Applications tab's badge counts unread application updates: let it refresh.
  window.dispatchEvent(new Event(NOTIFICATIONS_READ));
}

/** Fired after notifications are marked read here. */
export const NOTIFICATIONS_READ = "agentbnb:notifications-read";

/** The bell's last data without fetching (the header's bell keeps it fresh), e.g. for the home banner. */
export function useNotificationsSnapshot() {
  return useCachedJson<Inbox>(KEY) ?? EMPTY;
}

export function useNotifications() {
  const inbox = useCachedJson<Inbox>(KEY) ?? EMPTY;

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && load();
    // A push arrived (or was clicked): the bell and the Applications badge both refresh.
    const onMessage = (e: MessageEvent) =>
      e.data?.type === "agentbnb:notification" && window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    load();
    window.addEventListener("focus", load);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    document.addEventListener("visibilitychange", onVisible);
    const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;
    sw?.addEventListener("message", onMessage);
    sw?.startMessages();
    const timer = setInterval(onVisible, 60_000);
    return () => {
      window.removeEventListener("focus", load);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
      document.removeEventListener("visibilitychange", onVisible);
      sw?.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, []);

  /** Mark one read (optimistically) as the person opens it. */
  const read = useCallback((id: string) => {
    const now = readCached();
    const item = now.items.find((i) => i.id === id);
    if (!item || item.read) return;
    writeCachedJson(KEY, {
      ...now,
      unread: Math.max(0, now.unread - 1),
      items: now.items.map((i) => (i.id === id ? { ...i, read: true } : i)),
    });
    markRead([id]);
  }, []);

  const readAll = useCallback(() => {
    const now = readCached();
    writeCachedJson(KEY, { ...now, unread: 0, items: now.items.map((i) => ({ ...i, read: true })) });
    markRead();
  }, []);

  return { ...inbox, read, readAll };
}

function readCached(): Inbox {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "null") as Inbox | null) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}
