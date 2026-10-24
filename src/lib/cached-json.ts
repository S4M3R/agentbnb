import { useSyncExternalStore } from "react";

// Stale-while-revalidate for small per-person JSON the header and home fetch on every visit (who you
// are, unread count, what needs your attention). The last value lives in localStorage, so the page
// shows it as soon as it hydrates and swaps in the fresh one when the fetch lands. The server render
// always sees null, since it has no localStorage.

const EVENT = "agentbnb:cached-json";
const memo = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string): T | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {}
  const hit = memo.get(key);
  if (hit && hit.raw === raw) return hit.value as T | null; // same reference while unchanged
  let value: unknown = null;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {}
  memo.set(key, { raw, value });
  return value as T | null;
}

/** Save the fresh value and tell every `useCachedJson(key)` on the page. */
export function writeCachedJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

function subscribe(key: string, onChange: () => void) {
  const onLocal = (e: Event) => (e as CustomEvent<string>).detail === key && onChange();
  const onOtherTab = (e: StorageEvent) => e.key === key && onChange();
  window.addEventListener(EVENT, onLocal);
  window.addEventListener("storage", onOtherTab);
  return () => {
    window.removeEventListener(EVENT, onLocal);
    window.removeEventListener("storage", onOtherTab);
  };
}

/** The last saved value for `key` (null on the server and before the first fetch ever). */
export function useCachedJson<T>(key: string): T | null {
  return useSyncExternalStore(
    (onChange) => subscribe(key, onChange),
    () => read<T>(key),
    () => null,
  );
}
