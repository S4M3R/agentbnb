"use client";

import Link from "next/link";
import { useState } from "react";
import { formatRange } from "@/components/stays/format";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink, IconButton } from "@/components/ui/button";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { addMonths, focusMonth, monthOf, onNight, type CalendarData, type CalendarItem, type CalendarRow } from "./calendar";
import { formatDay, Legend, MonthGrid } from "./month-grid";
import { TONES } from "./tones";

const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export const formatMonth = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The full calendar: every place you host and every place you're staying, one month at a time.
 * Filter to one place or to your trips; pick a day to see exactly what happens that night.
 */
export function CalendarView({ data, initialMonth }: { data: CalendarData; initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth ?? focusMonth(data));
  const [selected, setSelected] = useState(data.today);
  const [filter, setFilter] = useState<string>("all");

  if (!data.rows.length) return <Empty />;

  const rows = filter === "all" ? data.rows : data.rows.filter((r) => r.id === filter);
  const shownIds = new Set(rows.map((r) => r.id));
  const shown = data.items.filter((i) => shownIds.has(i.row));
  const { trips } = data.summary;
  const warnings = [
    ...trips.overlaps.map((o) => ({ ...o, kind: "overlap" as const })),
    ...trips.gaps.map((g) => ({ ...g, kind: "gap" as const })),
  ].sort((a, b) => a.start.localeCompare(b.start));

  const jump = (date: string) => {
    setMonth(monthOf(date));
    setSelected(date);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-label="Calendar" className="flex min-w-0 flex-col gap-4">
        {warnings.length > 0 && (
          <ul className="flex flex-col gap-2">
            {warnings.map((w) => (
              <li key={`${w.kind}-${w.start}`}>
                <button
                  type="button"
                  onClick={() => jump(w.start)}
                  className="flex w-full items-center gap-3 rounded-xl border border-rausch/30 bg-rausch-soft px-4 py-3 text-left text-sm transition-colors hover:border-rausch"
                >
                  <AlertIcon size={18} className="shrink-0 text-rausch" />
                  <span className="flex-1 text-ink">
                    {w.kind === "gap" ? (
                      <>
                        <strong className="font-semibold">No place for {plural(w.nights, "night")}</strong>,{" "}
                        {formatRange(w.start, w.end)}, between two of your stays.
                      </>
                    ) : (
                      <>
                        <strong className="font-semibold">Two places booked</strong> for {formatRange(w.start, w.end)}. You
                        only need one.
                      </>
                    )}
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold text-rausch-deep underline underline-offset-2">Show</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="min-w-[10.5rem] text-[22px] font-semibold tracking-[-0.44px]">{formatMonth(month)}</h2>
            <IconButton label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeftIcon size={16} />
            </IconButton>
            <IconButton label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRightIcon size={16} />
            </IconButton>
            {month !== monthOf(data.today) && (
              <button
                type="button"
                onClick={() => jump(data.today)}
                className="ml-1 h-9 rounded-full px-3 text-sm font-semibold underline-offset-2 hover:underline"
              >
                Today
              </button>
            )}
          </div>
          {data.rows.length > 1 && <Filter rows={data.rows} value={filter} onChange={setFilter} />}
        </div>

        <MonthGrid month={month} data={data} rows={rows} selected={selected} onSelect={setSelected} />
        <Legend tones={[...new Set(shown.map((i) => i.tone))]} />
      </section>

      <aside aria-label="Details" className="flex flex-col gap-6 xl:pt-1">
        <DayDetail date={selected} data={data} rows={rows} />
        <Totals data={data} />
        <ComingUp items={shown} today={data.today} onPick={jump} />
      </aside>
    </div>
  );
}

function Filter({ rows, value, onChange }: { rows: CalendarRow[]; value: string; onChange: (v: string) => void }) {
  const places = rows.filter((r) => r.side === "hosting");
  const options = [
    { id: "all", label: "Everything" },
    ...rows.map((r) => ({ id: r.id, label: r.side === "trip" ? "Your trips" : places.length > 1 ? r.label : "Your place" })),
  ];
  return (
    <div role="radiogroup" aria-label="Show" className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-strong p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-8 max-w-[11rem] shrink-0 truncate rounded-full px-3.5 text-[13px] font-semibold transition-[background-color,box-shadow] ${
            value === o.id ? "bg-canvas text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** What happens on one night: who's at each of your places, and where you sleep. */
function DayDetail({ date, data, rows }: { date: string; data: CalendarData; rows: CalendarRow[] }) {
  const tonight = onNight(date, data.items);
  const places = rows.filter((r) => r.side === "hosting");
  const trips = rows.find((r) => r.side === "trip");
  const stays = tonight.filter((i) => i.row === trips?.id);

  return (
    <section aria-labelledby="day-detail" className="rounded-card border border-hairline-soft p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <h2 id="day-detail" className="text-base font-semibold">
        {formatDay(date)}
        {date === data.today && <span className="ml-2 text-[13px] font-semibold text-rausch">Today</span>}
      </h2>

      {places.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">
            {places.length > 1 ? "Your places" : "Your place"}
          </h3>
          <ul className="mt-2 flex flex-col gap-3">
            {places.map((p) => {
              const it = tonight.find((i) => i.row === p.id);
              const many = places.length > 1;
              const guest = it && (it.tone === "booked" || it.tone === "request" || it.tone === "overlap");
              return (
                <li key={p.id}>
                  <DetailRow
                    photo={it?.photo ?? p.photo}
                    name={it?.photo ? it.label : p.label}
                    title={guest && !many ? it.label : p.label}
                    line={nightLine(it, many)}
                    item={it}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {trips && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">Where you sleep</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {stays.length ? (
              stays.map((it) => (
                <li key={it.id}>
                  <DetailRow photo={it.photo} name={it.label} title={it.label} line={nightLine(it, false)} item={it} />
                </li>
              ))
            ) : (
              <li className="text-sm text-muted">Nothing planned.</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

function nightLine(it: CalendarItem | undefined, withLabel: boolean) {
  if (!it) return "Not open to guests";
  const range = formatRange(it.start, it.end);
  switch (it.tone) {
    case "booked":
      return `${withLabel ? `${it.label} is staying` : "Staying"} · ${range}`;
    case "overlap":
      return it.side === "hosting" ? `Double-booked · ${range}` : `${it.detail ?? "Overlaps another stay"} · ${range}`;
    case "request":
      return `${withLabel ? `${it.label}, ` : ""}waiting for your answer · ${range}`;
    case "open":
      return `Open, nobody booked · ${range}`;
    case "blocked":
      return `Blocked · ${range}`;
    case "gap":
      return `${it.detail} · ${range}`;
    default:
      return [it.detail, range].filter(Boolean).join(" · ");
  }
}

function DetailRow({
  photo,
  name,
  title,
  line,
  item,
}: {
  photo?: string | null;
  name: string;
  title: string;
  line: string;
  item?: CalendarItem;
}) {
  const body = (
    <>
      {photo ? (
        <Avatar name={name} src={photo} size={40} className="rounded-[10px]" />
      ) : (
        <span className={`size-10 shrink-0 rounded-[10px] ${item ? TONES[item.tone].swatch : "bg-surface-strong"}`} />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className={`text-[13px] leading-[18px] ${item?.tone === "gap" || item?.tone === "overlap" ? "text-error" : "text-muted"}`}>
          {line}
        </span>
      </span>
    </>
  );
  return item?.href ? (
    <Link href={item.href} className="-m-1.5 flex items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-surface-soft">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-3">{body}</div>
  );
}

function Totals({ data }: { data: CalendarData }) {
  const { hosting, trips } = data.summary;
  const hosts = data.rows.some((r) => r.side === "hosting");
  const travels = data.rows.some((r) => r.side === "trip");
  const stats = [
    hosts && { value: hosting.bookedNights, label: "nights hosting" },
    hosts && { value: hosting.openNights, label: "open nights" },
    hosts && hosting.requests > 0 && { value: hosting.requests, label: hosting.requests === 1 ? "request" : "requests", alert: true },
    travels && { value: trips.confirmedNights, label: "nights booked for you" },
    travels && trips.pendingNights > 0 && { value: trips.pendingNights, label: "nights waiting" },
    travels && trips.gaps.length > 0 && {
      value: trips.gaps.reduce((n, g) => n + g.nights, 0),
      label: "nights with no place",
      alert: true,
    },
  ].filter((s) => !!s);

  return (
    <section aria-labelledby="totals">
      <h2 id="totals" className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">
        From today
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-surface-soft px-3.5 py-3">
            <dt className="sr-only">{s.label}</dt>
            <dd className={`text-[22px] font-bold leading-7 tabular-nums ${s.alert ? "text-rausch" : ""}`}>{s.value}</dd>
            <dd className="text-xs text-muted">{s.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The next things on the calendar, skipping plain open nights. */
function ComingUp({ items, today, onPick }: { items: CalendarItem[]; today: string; onPick: (date: string) => void }) {
  const next = items
    .filter((i) => i.end > today && i.tone !== "open" && i.tone !== "blocked")
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 6);
  if (!next.length) return null;
  return (
    <section aria-labelledby="coming-up">
      <h2 id="coming-up" className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">
        Coming up
      </h2>
      <ul className="mt-2 flex flex-col">
        {next.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onPick(it.start < today ? today : it.start)}
              className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-soft"
            >
              <span className={`h-8 w-1.5 shrink-0 rounded-full ${TONES[it.tone].swatch}`} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{it.label}</span>
                <span className="truncate text-xs text-muted">
                  {[it.side === "hosting" ? "At your place" : "Your trip", it.detail].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums text-body">{formatRange(it.start, it.end)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Empty() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-card border border-dashed border-hairline px-6 py-14 text-center">
      <p className="text-xl font-semibold">Nothing on your calendar yet</p>
      <p className="mt-2 text-[15px] text-muted">
        Put your place up and the nights you host show here. Apply for a stay and you&apos;ll see where you sleep each
        night, and any night you still need a place.
      </p>
      <ButtonLink href="/" size="sm" className="mt-6">
        Ask your agent
      </ButtonLink>
    </div>
  );
}
