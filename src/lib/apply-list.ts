// The guest's apply list: stays they picked from the chat to apply to together, kept in this
// browser's localStorage so it survives reloads and new chats. Like chat-history.ts, everything
// goes through these functions, so moving it to the database later is a contained change.

export type ApplyListItem = {
  /** Listing id. */
  id: string;
  title: string;
  /** "Mission, San Francisco". */
  place: string;
  photo?: string | null;
  /** Source id, for the favicon. */
  site?: string | null;
  siteName?: string | null;
  /** Epoch ms. */
  addedAt: number;
};

/** applyToListings drafts at most 10 per call, and the list is applied to in one message. */
export const APPLY_LIST_MAX = 10;

/** Fired on window whenever the list changes, in this tab or another one. */
export const APPLY_LIST_CHANGED = "agentbnb:apply-list-changed";

const KEY = "agentbnb:apply-list";
const EMPTY: ApplyListItem[] = [];
let cache: { raw: string | null; list: ApplyListItem[] } = { raw: null, list: EMPTY };

const available = () => typeof window !== "undefined" && "localStorage" in window;

/** Oldest first, the order they were added. The same array is returned until something changes. */
export function getApplyList(): ApplyListItem[] {
  if (!available()) return EMPTY;
  const raw = window.localStorage.getItem(KEY);
  if (raw !== cache.raw) {
    let list: unknown = [];
    try {
      list = raw ? JSON.parse(raw) : [];
    } catch {}
    cache = { raw, list: Array.isArray(list) ? (list as ApplyListItem[]) : EMPTY };
  }
  return cache.list;
}

/** The server snapshot for useSyncExternalStore. */
export const getServerApplyList = () => EMPTY;

function write(list: ApplyListItem[]) {
  try {
    if (list.length) window.localStorage.setItem(KEY, JSON.stringify(list));
    else window.localStorage.removeItem(KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(APPLY_LIST_CHANGED));
}

/** Add a stay (once per listing). Returns false when the list is full. */
export function addToApplyList(item: Omit<ApplyListItem, "addedAt">) {
  if (!available()) return false;
  const list = getApplyList();
  if (list.some((i) => i.id === item.id)) return true;
  if (list.length >= APPLY_LIST_MAX) return false;
  write([...list, { ...item, addedAt: Date.now() }]);
  return true;
}

export function removeFromApplyList(id: string) {
  if (!available()) return;
  write(getApplyList().filter((i) => i.id !== id));
}

export function clearApplyList() {
  if (!available()) return;
  write([]);
}

export function subscribeApplyList(onChange: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key === KEY) && onChange();
  window.addEventListener(APPLY_LIST_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(APPLY_LIST_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The one chat message that asks the agent to draft every application at once. */
export function applyListPrompt(items: Pick<ApplyListItem, "id" | "title">[]) {
  const named = items.map((i) => `"${i.title.replace(/"/g, "'")}" (listing ${i.id})`).join(", ");
  return items.length === 1
    ? `Apply to this place for me: ${named}`
    : `Apply to these ${items.length} places for me: ${named}`;
}
