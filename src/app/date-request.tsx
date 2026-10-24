"use client";

import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { dateRange, nights } from "./requests/ui";

// The askForDates tool in the chat: a calendar to pick arrival and departure, limited to a
// listing's open windows when the agent passes them. Returns the two dates to the agent.

type Window = { start: string; end: string };
export type DateRequestInput = { intro: string; available?: Window[]; minNights?: number; flexible?: boolean };
export type DateRequestOutput = { startDate: string | null; endDate: string | null };

// Dates are YYYY-MM-DD strings, done in UTC so no time zone shifts a day.
const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(parse(d) + n * DAY);
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return iso(Date.UTC(y, m - 1 + n, 1)).slice(0, 7);
};
const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** The days of a month (YYYY-MM), padded with nulls so the 1st falls on its weekday. */
function monthDays(month: string) {
  const first = parse(`${month}-01`);
  const count = (parse(`${addMonths(month, 1)}-01`) - first) / DAY;
  return [
    ...Array<null>(new Date(first).getUTCDay()).fill(null),
    ...Array.from({ length: count }, (_, i) => iso(first + i * DAY)),
  ];
}

export function DateRequest({
  input,
  done,
  disabled = false,
  onDone,
}: {
  input: DateRequestInput;
  done?: DateRequestOutput;
  disabled?: boolean;
  onDone?: (output: DateRequestOutput) => void;
}) {
  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const windows = (input.available ?? []).filter((w) => w.end >= today);
  const minNights = input.minNights ?? 1;
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const opens = windows.map((w) => w.start).sort()[0];
  const firstMonth = (opens && opens > today ? opens : today).slice(0, 7);
  const [month, setMonth] = useState(firstMonth);
  const interactive = !done && !disabled;

  if (done) {
    const label = done.startDate
      ? [dateRange(done.startDate, done.endDate), nights(done.startDate, done.endDate)].filter(Boolean).join(" · ")
      : "Flexible dates";
    return (
      <div className="inline-flex items-center self-start gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-sm font-medium text-ink">
        <CalendarIcon size={15} className="text-rausch" />
        {label}
      </div>
    );
  }

  /** The open window a day falls in (a stand-in covering every future day when there are none). */
  const windowOf = (d: string) =>
    d < today ? undefined : windows.length ? windows.find((w) => w.start <= d && d <= w.end) : { start: today, end: "9999-12-31" };

  // Picking the departure: only days after the minimum stay, inside the arrival's window.
  const picking = start && !end ? windowOf(start) : undefined;
  const earliestEnd = start ? addDays(start, minNights) : null;
  const canEnd = (d: string) => Boolean(picking && earliestEnd && d >= earliestEnd && d <= picking.end);
  const canStart = (d: string) => {
    const w = windowOf(d);
    return Boolean(w && addDays(d, minNights) <= w.end);
  };

  function pick(d: string) {
    if (canEnd(d)) {
      setEnd(d);
    } else if (canStart(d)) {
      setStart(d);
      setEnd(null);
    }
  }

  const rangeEnd = end ?? (hover && canEnd(hover) ? hover : null);
  const summary = start
    ? end
      ? [dateRange(start, end), nights(start, end)].join(" · ")
      : `Arrive ${dateRange(start, null)}. Now pick your departure.`
    : "Pick your arrival date.";

  function renderMonth(month: string) {
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-2 text-center text-[15px] font-semibold text-ink">{monthName.format(parse(`${month}-01`))}</div>
        <div className="grid grid-cols-7 text-center">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="pb-1 text-xs font-medium text-muted">
              {w}
            </div>
          ))}
          {monthDays(month).map((d, i) => {
            if (!d) return <div key={i} />;
            const selected = d === start || d === rangeEnd;
            const between = Boolean(start && rangeEnd && d > start && d < rangeEnd);
            const enabled = interactive && (canEnd(d) || canStart(d));
            // The lozenge joining arrival and departure runs behind the circles.
            const band =
              between
                ? "bg-surface-soft"
                : rangeEnd && d === start
                  ? "bg-[linear-gradient(to_right,transparent_50%,var(--color-surface-soft)_50%)]"
                  : start && d === rangeEnd
                    ? "bg-[linear-gradient(to_left,transparent_50%,var(--color-surface-soft)_50%)]"
                    : "";
            return (
              <div key={d} className={`flex justify-center py-0.5 ${band}`}>
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => pick(d)}
                  onMouseEnter={() => setHover(d)}
                  aria-pressed={selected}
                  aria-label={new Date(parse(d)).toLocaleDateString("en-US", { dateStyle: "full", timeZone: "UTC" })}
                  className={`size-10 rounded-full text-sm transition-colors ${
                    selected
                      ? "bg-ink font-semibold text-white"
                      : enabled
                        ? "font-medium text-ink hover:border hover:border-ink"
                        : "text-border-strong line-through"
                  } ${d === today && !selected ? "underline underline-offset-4" : ""}`}
                >
                  {Number(d.slice(8))}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const lastMonth = windows.length ? windows.map((w) => w.end).sort().at(-1)!.slice(0, 7) : addMonths(firstMonth, 18);

  return (
    <div className={`space-y-4 rounded-card border border-hairline bg-canvas p-4 sm:p-5 ${disabled ? "opacity-50" : ""}`}>
      <p className="text-[15px] leading-relaxed text-ink">{input.intro}</p>
      {interactive && (
        <>
          <div className="relative" onMouseLeave={() => setHover(null)}>
            <div className="absolute inset-x-0 top-0 flex justify-between">
              <IconButton label="Previous month" tone="soft" disabled={month <= firstMonth} onClick={() => setMonth(addMonths(month, -1))} className="size-8 disabled:opacity-40">
                <ChevronLeftIcon size={16} />
              </IconButton>
              <IconButton label="Next month" tone="soft" disabled={month >= lastMonth} onClick={() => setMonth(addMonths(month, 1))} className="size-8 disabled:opacity-40">
                <ChevronRightIcon size={16} />
              </IconButton>
            </div>
            <div className="flex gap-8 pt-1">
              {renderMonth(month)}
              <div className="hidden min-w-0 flex-1 sm:flex">{renderMonth(addMonths(month, 1))}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              <div className="font-semibold text-ink">{summary}</div>
              {minNights > 1 && <div className="text-[13px] text-muted">{minNights}-night minimum</div>}
            </div>
            <div className="flex items-center gap-2">
              {start ? (
                <Button variant="ghost" size="sm" onClick={() => (setStart(null), setEnd(null))}>
                  Clear
                </Button>
              ) : (
                input.flexible && (
                  <Button variant="ghost" size="sm" onClick={() => onDone?.({ startDate: null, endDate: null })}>
                    I&apos;m flexible
                  </Button>
                )
              )}
              <Button size="sm" disabled={!start || !end} onClick={() => start && end && onDone?.({ startDate: start, endDate: end })}>
                Use these dates
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
