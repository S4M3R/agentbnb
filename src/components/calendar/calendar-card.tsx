"use client";

import Link from "next/link";
import { useState } from "react";
import { formatRange } from "@/components/stays/format";
import { IconButton } from "@/components/ui/button";
import { AlertIcon, CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { addMonths, focusMonth, type CalendarData } from "./calendar";
import { formatMonth } from "./calendar-view";
import { Legend, MonthGrid } from "./month-grid";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The calendar in a chat turn: one compact month, the line that matters, and a link to the full view. */
export function CalendarCard({ data, month: initial, side }: { data: CalendarData; month?: string; side?: "hosting" | "trip" }) {
  const [month, setMonth] = useState(initial ?? focusMonth(data, side));
  const rows = side ? data.rows.filter((r) => r.side === side) : data.rows;
  const ids = new Set(rows.map((r) => r.id));
  const { hosting, trips } = data.summary;
  const gap = trips.gaps[0];
  const overlap = trips.overlaps[0];

  const lines = [
    rows.some((r) => r.side === "hosting") &&
      [
        `${plural(hosting.bookedNights, "night")} hosting`,
        `${hosting.openNights} open`,
        hosting.requests > 0 && plural(hosting.requests, "request"),
      ]
        .filter(Boolean)
        .join(" · "),
    rows.some((r) => r.side === "trip") &&
      [`${plural(trips.confirmedNights, "night")} booked for you`, trips.pendingNights > 0 && `${trips.pendingNights} waiting`]
        .filter(Boolean)
        .join(" · "),
  ].filter(Boolean);

  return (
    <section aria-label="Your calendar" className="w-full max-w-[520px] rounded-card border border-hairline-soft bg-canvas p-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.05)] sm:p-4">
      <header className="flex items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-strong">
          <CalendarIcon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-5">{formatMonth(month)}</p>
          {lines.length > 0 && <p className="truncate text-xs text-muted">{lines.join(" — ")}</p>}
        </div>
        <IconButton label="Previous month" className="size-8" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeftIcon size={15} />
        </IconButton>
        <IconButton label="Next month" className="size-8" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRightIcon size={15} />
        </IconButton>
      </header>

      {(gap || overlap) && (!side || side === "trip") && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-rausch-soft px-3 py-2 text-[13px] leading-[18px] text-ink">
          <AlertIcon size={15} className="mt-px shrink-0 text-rausch" />
          {overlap ? (
            <span>
              <strong className="font-semibold">Two places booked</strong> for {formatRange(overlap.start, overlap.end)}.
            </span>
          ) : (
            <span>
              <strong className="font-semibold">No place for {plural(gap.nights, "night")}</strong>,{" "}
              {formatRange(gap.start, gap.end)}.
            </span>
          )}
        </p>
      )}

      <div className="mt-3">
        <MonthGrid month={month} data={data} rows={rows} compact />
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <Legend compact tones={[...new Set(data.items.filter((i) => ids.has(i.row)).map((i) => i.tone))]} />
        <Link href={`/calendar?month=${month}`} className="text-[13px] font-semibold underline underline-offset-2">
          Open calendar
        </Link>
      </div>
    </section>
  );
}
