"use client";

import { useEffect, useSyncExternalStore } from "react";

// Browser push on this device: its state, and turning it on or off. One store for the whole page,
// so the account menu, the home banner and the cards on /applications and /hosting agree.
// Permission is only ever requested from `enable()`, which must run inside a click handler.

export type PushState =
  /** Not checked yet (server render, first paint). */
  | "loading"
  /** This browser can't do Web Push (or the server has no VAPID key). */
  | "unsupported"
  /** iPhone / iPad in Safari: push works only once AgentBnB is on the Home Screen (iOS 16.4+). */
  | "ios-install"
  /** Never asked: "Turn on" shows the browser's permission prompt. */
  | "default"
  /** Allowed, but not subscribed on this device (turned off here): "Turn on" needs no prompt. */
  | "off"
  /** Subscribed: pushes arrive on this device. */
  | "on"
  /** Blocked in the browser's site settings; only the person can undo that. */
  | "denied";

type Snapshot = { state: PushState; busy: boolean; error: string | null; ios: boolean };

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const SW = "/sw.js";

let snapshot: Snapshot = { state: "loading", busy: false, error: null, ios: false };
const SERVER: Snapshot = snapshot;
const listeners = new Set<() => void>();
let checked = false;

function set(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** iPhone or iPad (iPadOS reports itself as a Mac, but with touch). */
export function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Opened from the Home Screen rather than in a browser tab. */
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function supported() {
  return !!VAPID && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function register() {
  // `updateViaCache: "none"`: the browser always re-fetches sw.js (and its imports) to look for updates.
  return navigator.serviceWorker.register(SW, { scope: "/", updateViaCache: "none" });
}

async function check() {
  const ios = isIOS();
  if (ios !== snapshot.ios) set({ ios });
  if (ios && !isStandalone()) return set({ state: "ios-install" });
  if (!supported()) return set({ state: "unsupported" });
  if (Notification.permission === "denied") return set({ state: "denied" });
  // Only touch the worker if this browser already has it: a first visit registers nothing.
  const existing = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
  const reg = existing ? await register().catch(() => existing) : undefined;
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub && Notification.permission === "granted") return set({ state: "on" });
  set({ state: Notification.permission === "granted" ? "off" : "default" });
}

function base64ToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Turn push on for this device. Call straight from a click: it may show the permission prompt. */
async function enable() {
  if (snapshot.busy || !supported()) return false;
  set({ busy: true, error: null });
  try {
    // First thing in the click, before any other await: Safari only prompts inside the user gesture.
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      set({ state: permission === "denied" ? "denied" : "default" });
      return false;
    }
    await register();
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(VAPID!) }));
    const res = await fetch("/api/push/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
    set({ state: "on" });
    return true;
  } catch (err) {
    console.error("turning on notifications failed", err);
    set({ error: "Couldn't turn notifications on. Try again." });
    return false;
  } finally {
    set({ busy: false });
  }
}

/** Stop pushes to this device (the inbox and email carry on). */
async function disable() {
  if (snapshot.busy) return;
  set({ busy: true, error: null });
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscription", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
    set({ state: "off" });
  } catch (err) {
    console.error("turning off notifications failed", err);
    set({ error: "Couldn't turn notifications off. Try again." });
  } finally {
    set({ busy: false });
  }
}

/** Send a test notification to the person (push on their devices, plus the bell). */
async function sendTest(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/notifications/test", { method: "POST" }).catch(() => null);
  const body = await res?.json().catch(() => null);
  if (!res?.ok) return { ok: false, message: body?.error?.message ?? "Couldn't send it. Try again." };
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  return {
    ok: true,
    message: body?.pushed ? "Sent. It should pop up in a moment." : "Sent to your inbox. No device got the push.",
  };
}

/** Fired when notifications change on this page (a test, marking read), so the bell refreshes. */
export const NOTIFICATIONS_CHANGED = "agentbnb:notifications-changed";

export type Push = Snapshot & {
  enable: () => Promise<boolean>;
  disable: () => Promise<void>;
  sendTest: () => Promise<{ ok: boolean; message: string }>;
};

export function usePush(): Push {
  const snap = useSyncExternalStore(subscribe, () => snapshot, () => SERVER);
  useEffect(() => {
    if (checked) return;
    checked = true;
    check().catch(() => set({ state: "unsupported" }));
    // Coming back from the browser's settings (unblocked, or blocked) updates the state.
    if ("permissions" in navigator) {
      navigator.permissions
        .query({ name: "notifications" })
        .then((status) => status.addEventListener("change", () => check().catch(() => {})))
        .catch(() => {});
    }
  }, []);
  // Module-level functions: stable across renders already.
  return { ...snap, enable, disable, sendTest };
}
