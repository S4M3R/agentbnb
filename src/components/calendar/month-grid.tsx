import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { formatRange } from "@/components/stays/format";
import { layoutMonth, onNight, type CalendarData, type CalendarRow, type Segment, type Tone } from "./calendar";
import { TONE_LEGEND, TONES } from "./tones";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const longDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
export const formatDay = (date: string) => longDay.format(new Date(`${date}T00:00:00Z`));

/**
 * One month, Sunday first. Each of your places gets a lane of bars (guests, requests, open and
 * blocked nights), then a lane for where you sleep; a bar spans the nights it covers. Tapping a
 * day selects it; bars with a page link to it.
 */
export function MonthGrid({
  month,
  data,
  rows,
  selected,
  onSelect,
  compact = false,
}: {
  month: string;
  data: CalendarData;
  /** Rows to show, e.g. only your trips. Defaults to all of them. */
  rows?: CalendarRow[];
  selected?: string | null;
  onSelect?: (date: string) => void;
  compact?: boolean;
}) {
  const weeks = layoutMonth(month, rows ?? data.rows, data.items);
  const bar = compact ? 18 : 24;
  const head = compact ? 26 : 34;

  return (
    <div role="grid" aria-label={`Calendar for ${month}`} className="overflow-hidden rounded-card border border-hairline-soft">
      <div role="row" className="grid grid-cols-7 border-b border-hairline-soft bg-surface-soft">
        {WEEKDAYS.map((d) => (
          <span
            key={d}
            role="columnheader"
            className={`text-center font-semibold text-muted ${compact ? "py-1 text-[11px]" : "py-2 text-xs"}`}
          >
            {compact ? d.slice(0, 1) : d}
          </span>
        ))}
      </div>

      {weeks.map((week) => (
        <div
          key={week.days[0].date}
          role="row"
          className={`grid grid-cols-7 gap-y-[3px] border-b border-hairline-soft last:border-b-0 ${
            compact ? "min-h-[46px]" : week.lanes.length ? "min-h-[108px]" : "min-h-[76px]"
          }`}
          style={{ gridTemplateRows: `${head}px repeat(${week.lanes.length}, ${bar}px) minmax(${compact ? 4 : 10}px, 1fr)` }}
        >
          {week.days.map((day, i) => {
            const past = day.date < data.today;
            const isToday = day.date === data.today;
            const isSelected = day.date === selected;
            const here = onNight(day.date, data.items).filter((it) => it.tone !== "open");
            return (
              <button
                key={day.date}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={[formatDay(day.date), ...here.map((it) => it.label)].join(", ")}
                onClick={() => onSelect?.(day.date)}
                style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
                className={`flex items-start border-r border-hairline-soft text-left transition-colors last:border-r-0 ${
                  isSelected ? "bg-surface-soft" : day.inMonth ? "hover:bg-surface-soft" : "bg-surface-soft/60"
                } ${onSelect ? "" : "cursor-default"} ${compact ? "p-1" : "p-1.5"}`}
              >
                <span
                  className={`flex items-center justify-center rounded-full tabular-nums ${compact ? "size-[18px] text-[11px]" : "size-[26px] text-[13px]"} ${
                    isSelected
                      ? "bg-ink font-bold text-white"
                      : isToday
                        ? "font-bold text-rausch"
                        : !day.inMonth
                          ? "text-muted-soft"
                          : past
                            ? "text-muted"
                            : "font-medium text-ink"
                  }`}
                >
                  {Number(day.date.slice(8))}
                </span>
                {isToday && !compact && <span className="mt-[11px] ml-0.5 size-1 rounded-full bg-rausch" />}
              </button>
            );
          })}

          {week.lanes.map((lane, l) =>
            lane.segments.map((s) => (
              <Bar key={`${s.item.id}-${l}`} segment={s} lane={l} compact={compact} past={s.item.end <= data.today} />
            )),
          )}
        </div>
      ))}
    </div>
  );
}

function Bar({ segment: s, lane, compact, past }: { segment: Segment; lane: number; compact: boolean; past: boolean }) {
  const it = s.item;
  const width = s.to - s.from;
  const showDetail = !compact && it.detail && width >= 3;
  const className = `relative z-10 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap font-semibold ${
    compact ? "px-1 text-[10px]" : "px-1.5 text-[11.5px]"
  } ${TONES[it.tone].bar} ${s.continuesBefore ? "rounded-l-none border-l-0" : "ml-[3px] rounded-l-md"} ${
    s.continuesAfter ? "rounded-r-none border-r-0" : "mr-[3px] rounded-r-md"
  } ${past ? "opacity-50" : ""} ${it.href ? "transition-[filter] hover:brightness-95" : "pointer-events-none"}`;
  const style = { gridColumn: `${s.from + 1} / ${s.to + 1}`, gridRow: lane + 2 };
  const title = [it.label, it.detail, formatRange(it.start, it.end)].filter(Boolean).join(" · ");

  const body = (
    <>
      {!compact && it.photo && width >= 2 && <Avatar name={it.label} src={it.photo} size={16} />}
      <span className="max-w-full flex-none truncate">{it.label}</span>
      {showDetail && <span className="min-w-0 truncate font-normal opacity-80">· {it.detail}</span>}
    </>
  );

  return it.href ? (
    <Link href={it.href} title={title} className={className} style={style}>
      {body}
    </Link>
  ) : (
    <span title={title} className={className} style={style}>
      {body}
    </span>
  );
}

/** Swatches for the kinds of nights that appear in `tones`. */
export function Legend({ tones, compact = false }: { tones: Tone[]; compact?: boolean }) {
  const shown = TONE_LEGEND.filter((t) => tones.includes(t));
  if (!shown.length) return null;
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1.5 text-muted ${compact ? "text-[11px]" : "text-xs"}`}>
      {shown.map((t) => (
        <li key={t} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-4 rounded-[3px] ${TONES[t].swatch}`} />
          {TONES[t].legend}
        </li>
      ))}
    </ul>
  );
}
