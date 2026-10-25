"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Couchbot } from "@/components/brand/logo";
import { BellIcon, CloseIcon } from "@/components/ui/icons";
import { RollingNumber } from "@/components/ui/rolling-number";

// The header's bell: a round button with the unread count, opening the newest notifications as a
// dropdown under it (a bottom sheet on phones). Props in, no fetching: `useNotifications()` owns the
// data; picking one calls `onOpenItem` (mark it read) and follows its link.

export type BellItem = {
  id: string;
  title: string;
  body: string | null;
  /** Path to open; items without one open `fallbackHref`. */
  url: string | null;
  read: boolean;
  /** ISO time. */
  at: string;
};

function timeAgo(iso: string, now: number) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NotificationBell({
  items,
  unread,
  onOpenItem,
  onMarkAllRead,
  fallbackHref,
  footer,
}: {
  items: BellItem[];
  unread: number;
  onOpenItem: (item: BellItem) => void;
  onMarkAllRead: () => void;
  fallbackHref: string;
  /** Under the list, e.g. the push switch and a link to all notifications. */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  // A new notification rings the bell once (each ring replays the swing). The count jumps from 0
  // to the cached inbox as each page loads, so only rings after the first moment on the page.
  const [rings, setRings] = useState(0);
  const [seen, setSeen] = useState(unread);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  if (unread !== seen) {
    if (armed && unread > seen) setRings((n) => n + 1);
    setSeen(unread);
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setNow(Date.now());
          setOpen(!open);
        }}
        className={`relative flex size-[42px] items-center justify-center rounded-full text-ink transition-[background-color,box-shadow] duration-200 hover:bg-surface-strong ${open ? "bg-surface-strong" : ""}`}
      >
        <span key={rings} className={`flex origin-top ${rings > 0 ? "motion-safe:animate-bell-swing" : ""}`}>
          <BellIcon size={20} strokeWidth={1.9} />
        </span>
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rausch px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-canvas tabular-nums">
            <RollingNumber value={unread} format={(n) => (n > 99 ? "99+" : String(n))} />
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Phones: a bottom sheet over a scrim. */}
          <div aria-hidden="true" className="fixed inset-0 z-40 bg-ink/40 sm:hidden motion-safe:animate-fade-in" onClick={close} />
          <div
            id={id}
            role="dialog"
            aria-label="Notifications"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-[24px] bg-canvas pb-[env(safe-area-inset-bottom)] shadow-float motion-safe:animate-rise sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[min(560px,80dvh)] sm:w-[380px] sm:origin-top-right sm:rounded-2xl sm:pb-0 sm:motion-safe:animate-menu-in"
          >
            <span aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-hairline sm:hidden" />
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 sm:pt-4">
              <h2 className="flex-1 text-base font-semibold">Notifications</h2>
              <button
                type="button"
                onClick={onMarkAllRead}
                disabled={unread === 0}
                className="rounded-md px-1.5 py-1 text-[13px] font-semibold text-ink underline underline-offset-2 transition-colors hover:bg-surface-soft disabled:text-muted-soft disabled:no-underline disabled:hover:bg-transparent"
              >
                Mark all as read
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-full hover:bg-surface-strong sm:hidden"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            <NotificationList
              items={items}
              now={now}
              fallbackHref={fallbackHref}
              onOpenItem={(item) => {
                onOpenItem(item);
                close();
              }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1"
            />

            {footer && (
              <div className="shrink-0 border-t border-hairline-soft" onClick={(e) => (e.target as HTMLElement).closest("a") && close()}>
                {footer}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The notifications as a list of links, newest first, with an empty state. Used by the bell and /me/notifications. */
export function NotificationList({
  items,
  now,
  fallbackHref,
  onOpenItem,
  className = "",
}: {
  items: BellItem[];
  /** Time the "5m ago" labels count from (ms); 0 hides them (before hydration). */
  now: number;
  fallbackHref: string;
  onOpenItem: (item: BellItem) => void;
  className?: string;
}) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center px-6 pb-8 pt-4 text-center">
        <Couchbot mood="sleepy" size={56} />
        <p className="mt-3 text-sm font-semibold">Nothing yet</p>
        <p className="mt-1 text-[13px] text-muted">I&apos;ll let you know here when a host replies or I need you.</p>
      </div>
    );
  }
  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={item.url ?? fallbackHref}
            onClick={() => onOpenItem(item)}
            className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-offset-[-2px]"
          >
            <span className="flex w-2 shrink-0 justify-center pt-[7px]">
              {!item.read && <span className="size-2 rounded-full bg-rausch" aria-label="Unread" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm leading-snug text-ink ${item.read ? "font-medium" : "font-semibold"}`}>
                {item.title}
              </span>
              {item.body && <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{item.body}</span>}
              {now > 0 && (
                <span className="mt-1 block text-xs text-muted-soft">
                  <time dateTime={item.at}>{timeAgo(item.at, now)}</time>
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
