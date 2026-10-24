"use client";

import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";
import { faviconFor } from "@/lib/source-logos";

export type SourceOption = {
  id: string;
  name: string;
  /** Matching stays in the current view. */
  count: number;
};

/**
 * Airbnb's Filters modal, for marketplaces: a checkbox per source with its logo, "Clear all" and
 * a Rausch "Show N stays". Changes are a draft until applied. Native <dialog>, so focus, Escape
 * and the 50% scrim come from the browser.
 */
export function FiltersDialog({
  open,
  sources,
  hidden,
  onApply,
  onClose,
}: {
  open: boolean;
  sources: SourceOption[];
  hidden: Set<string>;
  onApply: (hidden: Set<string>) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    dialog.showModal();
    // Also runs when Next hides this page mid-dialog, so the modal doesn't outlive the page.
    return () => dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="filters-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the dialog itself (not its panel) is a click on the scrim.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[min(100%-2rem,35rem)] max-w-none overflow-hidden rounded-xl bg-canvas p-0 text-ink shadow-float backdrop:bg-black/50 open:animate-pop motion-reduce:open:animate-none max-nav:mb-0 max-nav:w-full max-nav:rounded-b-none"
    >
      {open && <FiltersBody sources={sources} hidden={hidden} onApply={onApply} onClose={onClose} />}
    </dialog>
  );
}

function FiltersBody({
  sources,
  hidden,
  onApply,
  onClose,
}: Omit<Parameters<typeof FiltersDialog>[0], "open">) {
  const [draft, setDraft] = useState(() => new Set(hidden));
  const total = sources.reduce((n, s) => (draft.has(s.id) ? n : n + s.count), 0);

  const toggle = (id: string) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex max-h-[min(85dvh,46rem)] flex-col">
      <header className="relative flex h-16 shrink-0 items-center justify-center border-b border-hairline-soft px-6">
        <IconButton label="Close" tone="soft" onClick={onClose} className="absolute left-4 size-8 bg-transparent">
          <CloseIcon size={16} strokeWidth={2.4} />
        </IconButton>
        <h2 id="filters-title" className="text-base font-bold">
          Filters
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <h3 className="text-[22px] font-medium tracking-[-0.02em]">Marketplaces</h3>
        <p className="mt-1 text-sm text-muted">Where the stays come from. Counts are for the map area.</p>
        <ul className="mt-4 grid gap-x-6 sm:grid-cols-2">
          {sources.map((s) => {
            const on = !draft.has(s.id);

            return (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-3 py-3">
                  <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="peer sr-only" />
                  <span
                    aria-hidden="true"
                    className={`flex size-6 shrink-0 items-center justify-center rounded-[4px] border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${
                      on ? "border-ink bg-ink text-white" : "border-border-strong bg-canvas text-transparent"
                    }`}
                  >
                    <CheckIcon size={14} strokeWidth={3} />
                  </span>
                  {faviconFor(s.id) ? (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline-soft">
                      <SiteIcon site={s.id} size={18} />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-xs font-semibold text-body"
                    >
                      {s.name.slice(0, 1)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-base">{s.name}</span>
                  <span className="text-sm tabular-nums text-muted">{s.count.toLocaleString()}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-hairline-soft px-6 py-4">
        <button
          type="button"
          onClick={() => setDraft(new Set())}
          disabled={draft.size === 0}
          className="rounded-lg px-2 py-2.5 -mx-2 text-base font-semibold underline underline-offset-2 transition-colors hover:bg-surface-soft disabled:text-muted disabled:no-underline disabled:hover:bg-transparent"
        >
          Clear all
        </button>
        <Button onClick={() => onApply(draft)} className="min-w-40">
          Show {total.toLocaleString()} {total === 1 ? "stay" : "stays"}
        </Button>
      </footer>
    </div>
  );
}
