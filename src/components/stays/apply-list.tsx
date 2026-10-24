"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon, PinIcon, SuitcaseIcon } from "@/components/ui/icons";
import { SiteName } from "@/components/ui/site-name";

export type ApplyListRow = {
  id: string;
  title: string;
  place: string;
  photo?: string | null;
  /** Source id, for the favicon. */
  site?: string | null;
  siteName?: string | null;
};

/**
 * The guest's apply list: the stays they picked, each with a remove button, then "Apply to N
 * places" (one message to the agent, which drafts them all) and Clear. `onClose` adds a close
 * button to the header, for the dock and the sheet.
 */
export function ApplyList({
  items,
  max,
  onRemove,
  onApply,
  onClear,
  onClose,
  disabled,
}: {
  items: ApplyListRow[];
  /** The most it holds, mentioned once it's full. */
  max?: number;
  onRemove: (id: string) => void;
  onApply: () => void;
  onClear: () => void;
  onClose?: () => void;
  /** While the agent is busy: Apply waits. */
  disabled?: boolean;
}) {
  const n = items.length;
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 pl-6 pr-3">
        <h2 className="truncate text-[17px] font-semibold">
          Your apply list{n > 0 && <span className="font-normal text-muted"> · {n}</span>}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close apply list"
            className="flex size-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-strong"
          >
            <CloseIcon size={18} />
          </button>
        )}
      </header>

      {n === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-soft text-ink">
            <SuitcaseIcon size={22} />
          </span>
          <p className="text-[15px] font-semibold">Nothing on your list yet</p>
          <p className="text-sm text-muted">Tap “Add to list” on any stay, then apply to all of them at once.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-surface-soft motion-safe:animate-rise"
            >
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-strong text-muted">
                {item.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
                  <img src={item.photo} alt="" className="size-full object-cover" />
                ) : (
                  <PinIcon size={20} />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold leading-5">{item.title}</span>
                <span className="truncate text-[13px] leading-[18px] text-muted">{item.place}</span>
                {item.siteName && (
                  <SiteName site={item.site} size={14} className="text-[13px] leading-[18px] text-muted">
                    {item.siteName}
                  </SiteName>
                )}
              </span>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.title}`}
                title="Remove"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-strong hover:text-ink"
              >
                <CloseIcon size={16} />
              </button>
            </li>
          ))}
          {max != null && n >= max && (
            <li className="px-3 pt-1 text-[13px] text-muted">That&apos;s the most I can apply to at once.</li>
          )}
        </ul>
      )}

      {n > 0 && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-hairline-soft px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" size="sm" onClick={onClear} className="-ml-3 underline underline-offset-2">
            Clear
          </Button>
          <Button size="sm" onClick={onApply} disabled={disabled} className="ml-auto">
            Apply to {n} {n === 1 ? "place" : "places"}
          </Button>
        </footer>
      )}
    </div>
  );
}

/** The list docked on the right of the chat, from `lg` up. */
export function ApplyListDock({ children }: { children: ReactNode }) {
  return (
    <aside
      aria-label="Your apply list"
      className="hidden w-[360px] shrink-0 border-l border-hairline-soft shadow-[-12px_0_32px_rgb(0_0_0/0.04)] motion-safe:animate-panel-in lg:block"
    >
      {children}
    </aside>
  );
}

/** The list as a bottom sheet on smaller screens. Escape or the backdrop calls `onClose`. */
export function ApplyListSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true" aria-label="Your apply list">
      <button
        type="button"
        aria-label="Close apply list"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div className="relative flex max-h-[85dvh] min-h-[40dvh] flex-col overflow-hidden rounded-t-[24px] bg-canvas shadow-float motion-safe:animate-rise">
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-hairline" />
        {children}
      </div>
    </div>
  );
}

/** "Apply list · 3": brings the list back when something else has the right side, or opens the sheet. */
export function ApplyListPill({ count, onClick, className = "" }: { count: number; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 items-center gap-2 rounded-full bg-ink pl-3.5 pr-4 text-sm font-semibold text-white shadow-float transition-transform hover:scale-[1.02] active:scale-[0.98] motion-safe:animate-rise motion-reduce:transition-none ${className}`}
    >
      <SuitcaseIcon size={16} />
      Apply list
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rausch px-1.5 text-xs tabular-nums">{count}</span>
    </button>
  );
}
