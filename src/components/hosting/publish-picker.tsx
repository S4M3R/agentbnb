import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";
import { PublishChip } from "./publish-status";
import type { PickerRow } from "./types";

/**
 * "Where else to list it": every network as a tile to tick (recommended ones come ticked), then a
 * sticky footer with "Publish to N sites" and Clear. Networks the listing is already live or
 * publishing on show their status instead of a checkbox, with `progress` (the live browser card)
 * underneath. Used in the chat card and in the listings page's dialog (`framed={false}`).
 */
export function PublishPicker({
  rows,
  heading,
  lead,
  onToggle,
  onPublish,
  onClear,
  progress,
  publishing = false,
  error,
  footnote,
  framed = true,
}: {
  rows: PickerRow[];
  heading?: ReactNode;
  lead?: ReactNode;
  onToggle: (id: string) => void;
  onPublish: () => void;
  onClear: () => void;
  /** The publication card under a locked row. */
  progress?: (id: string) => ReactNode;
  /** While the publish request is in flight. */
  publishing?: boolean;
  error?: string | null;
  /** A muted line in the footer, e.g. "I open 3 at a time." */
  footnote?: ReactNode;
  /** Card border and padding; off inside a dialog that has its own. */
  framed?: boolean;
}) {
  const selected = rows.filter((r) => r.selected).length;
  const selectable = rows.some((r) => !r.locked);

  return (
    <div className={framed ? "rounded-card border border-hairline bg-canvas" : ""}>
      {(heading || lead) && (
        <div className={framed ? "px-4 pt-4 sm:px-5 sm:pt-5" : "pb-1"}>
          {heading && <h3 className="text-base font-semibold text-ink">{heading}</h3>}
          {lead && <p className="mt-0.5 text-sm text-muted">{lead}</p>}
        </div>
      )}

      <ul className={`space-y-2 ${framed ? "p-3 sm:p-4" : "py-3"}`}>
        {rows.map((row) => (
          <li key={row.id} className="space-y-2">
            {row.locked ? <LockedTile row={row} /> : <SelectTile row={row} onToggle={() => onToggle(row.id)} />}
            {row.locked && progress?.(row.id)}
          </li>
        ))}
      </ul>

      {error && <p className={`text-sm text-error ${framed ? "px-4 pb-3 sm:px-5" : "pb-3"}`}>{error}</p>}

      {selectable && (
        <footer
          className={`sticky bottom-0 z-10 flex items-center gap-3 border-t border-hairline-soft bg-canvas py-3 ${
            framed ? "rounded-b-card px-4 sm:px-5" : ""
          }`}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={selected === 0 || publishing}
            className="-ml-3 underline underline-offset-2 disabled:cursor-not-allowed disabled:text-muted disabled:no-underline disabled:hover:bg-transparent"
          >
            Clear
          </Button>
          {footnote && <span className="hidden min-w-0 truncate text-[13px] text-muted sm:block">{footnote}</span>}
          <Button size="sm" onClick={onPublish} disabled={selected === 0 || publishing} className="ml-auto">
            {publishing
              ? "Starting…"
              : selected === 0
                ? "Pick a site"
                : `Publish to ${selected} ${selected === 1 ? "site" : "sites"}`}
          </Button>
        </footer>
      )}
    </div>
  );
}

function TileBody({ row, trailing }: { row: PickerRow; trailing?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[15px] font-semibold text-ink">
          <SiteIcon site={row.id} size={18} />
          <span className="truncate">{row.name}</span>
        </span>
        {row.recommended && !row.locked && (
          <span className="rounded-full bg-rausch-soft px-2 py-0.5 text-[11px] font-semibold text-rausch-deep">
            Recommended
          </span>
        )}
        {trailing}
      </span>
      <span className="text-sm leading-snug text-body">{row.pitch}</span>
      <span className="text-[13px] leading-snug text-muted">{row.reason}</span>
      {row.note && <span className="text-[13px] leading-snug text-error">{row.note}</span>}
    </span>
  );
}

function SelectTile({ row, onToggle }: { row: PickerRow; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={row.selected}
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-xl border p-3.5 transition-[border-color,box-shadow,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        row.selected
          ? "border-ink bg-surface-soft shadow-[inset_0_0_0_1px_var(--color-ink)]"
          : "border-hairline hover:border-border-strong"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-md border transition-colors ${
          row.selected ? "border-ink bg-ink text-white" : "border-border-strong bg-canvas"
        }`}
      >
        {row.selected && <CheckIcon size={14} strokeWidth={3} />}
      </span>
      <TileBody row={row} trailing={row.status && <PublishChip status={row.status} />} />
    </button>
  );
}

function LockedTile({ row }: { row: PickerRow }) {
  return (
    <div className="flex w-full items-start gap-3 rounded-xl border border-hairline-soft bg-canvas p-3.5">
      <TileBody row={row} />
      {row.status && <PublishChip status={row.status} className="mt-0.5" />}
    </div>
  );
}
