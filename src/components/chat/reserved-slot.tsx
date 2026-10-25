"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { slotKey, type SlotName } from "@/lib/reserved-slots";

// Home sections that only exist in the browser (recent chats and the apply list live in localStorage,
// attention and the notifications banner come from cached fetches) can't be in the server HTML, so they
// used to push the page down a beat after load. Each sits in a ReservedSlot: it remembers its last
// height per screen size, an inline script in the root layout (SLOT_SCRIPT in src/lib/reserved-slots.ts) turns that into a CSS
// variable before first paint, and the slot holds that space until its real content renders.

// The browser runs effects; the server render needs a no-op so React doesn't warn.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Holds the space this section took last time until it renders, then measures it for next time.
 * Pass the gap above it as padding that only applies with content (e.g. `has-[>*]:pt-6`), so the
 * saved height includes it and an empty slot is 0px.
 */
export function ReservedSlot({ name, className = "", children }: { name: SlotName; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  // Once real content is in (or it clearly isn't coming), drop the reservation: min-height falls
  // back to 0 when the variable is gone. Then keep the saved height current for the next visit.
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const release = () => document.documentElement.style.removeProperty(`--slot-${name}`);
    const wide = window.innerWidth >= 640;
    const save = () => {
      const h = el.childElementCount > 0 ? Math.round(el.getBoundingClientRect().height) : 0;
      try {
        localStorage.setItem(slotKey(name, wide), String(h));
      } catch {}
    };
    if (el.childElementCount > 0) release();
    const giveUp = setTimeout(release, 2500); // nothing cached any more: don't hold space forever
    const ro = new ResizeObserver(save);
    ro.observe(el);
    return () => {
      clearTimeout(giveUp);
      ro.disconnect();
    };
  });

  return (
    <div ref={ref} data-slot={name} style={{ minHeight: `var(--slot-${name}, 0px)` }} className={`w-full ${className}`}>
      {children}
    </div>
  );
}
