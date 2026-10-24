// The calendar's model: what's happening at your places and where you sleep, night by night.
// Pure functions so the page, the chat card and the dev screens share them. Dates are
// YYYY-MM-DD strings; a stay covers its nights, from `start` up to (not including) `end`.

/** A guest at one of your places. Hosts see these as bars in that place's row. */
export type HostedGuest = {
  id: string;
  /** Which of your places; null for requests imported without one. */
  placeId: string | null;
  name: string;
  photo?: string | null;
  start: string;
  /** The morning they leave. */
  end: string;
  status: "booked" | "request";
  source?: string;
  href?: string;
};

/** One of your listings, with the date ranges you opened or blocked (both inclusive, like the listing form). */
export type HostedPlace = {
  id: string;
  title: string;
  photo?: string | null;
  open: { start: string; end: string }[];
  blocked: { start: string; end: string }[];
};

/** A place you're staying, or waiting to hear back from. */
export type TripStay = {
  id: string;
  title: string;
  /** Area or city, e.g. "Alfama, Lisbon". */
  where?: string | null;
  host?: string | null;
  photo?: string | null;
  start: string;
  /** The morning you leave. */
  end: string;
  status: "confirmed" | "pending";
  source?: string;
  href?: string;
};

export type CalendarInput = { today: string; places: HostedPlace[]; guests: HostedGuest[]; stays: TripStay[] };

export type Tone =
  | "booked" // a guest is staying at your place
  | "request" // someone asked to stay; you haven't said yes
  | "open" // your place is open and free
  | "blocked" // you closed these nights
  | "stay" // you have a confirmed place to sleep
  | "pending" // you applied and are waiting
  | "gap" // between two trips, with nowhere to sleep yet
  | "overlap"; // two confirmed places on the same night

/** A bar on the calendar. `row` keeps each place on its own line, and trips on theirs. */
export type CalendarItem = {
  id: string;
  row: string;
  side: "hosting" | "trip";
  tone: Tone;
  label: string;
  /** What the bar is about when the label alone isn't enough, e.g. the place or the host. */
  detail?: string;
  photo?: string | null;
  start: string;
  end: string;
  href?: string;
};

export type CalendarRow = { id: string; side: "hosting" | "trip"; label: string; photo?: string | null };

export type CalendarSummary = {
  /** Upcoming, from today. */
  hosting: { bookedNights: number; openNights: number; requests: number; nextGuest: CalendarItem | null };
  trips: {
    confirmedNights: number;
    pendingNights: number;
    gaps: { start: string; end: string; nights: number }[];
    overlaps: { start: string; end: string; nights: number }[];
    nextStay: CalendarItem | null;
  };
};

export type CalendarData = { today: string; rows: CalendarRow[]; items: CalendarItem[]; summary: CalendarSummary };

/** Nights between two trips that still count as "you need a place". Longer than this, you're probably home. */
export const MAX_GAP_NIGHTS = 7;

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const nightsBetween = (start: string, end: string) => Math.round((ms(end) - ms(start)) / DAY);
export const monthOf = (d: string) => d.slice(0, 7);
export const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
};

/** Each night in [start, end). */
function* nights(start: string, end: string) {
  for (let t = ms(start); t < ms(end); t += DAY) yield iso(t);
}

/** Runs of consecutive nights with the same key, as [start, end) ranges. */
function runs(byNight: Map<string, string>) {
  const out: { key: string; start: string; end: string }[] = [];
  for (const night of [...byNight.keys()].sort()) {
    const key = byNight.get(night)!;
    const last = out.at(-1);
    if (last && last.key === key && last.end === night) last.end = addDays(night, 1);
    else out.push({ key, start: night, end: addDays(night, 1) });
  }
  return out;
}

/** The nights we lay out: a month back, a year ahead. */
function span(today: string) {
  return { from: addDays(today, -45), to: addDays(today, 400) };
}

const clip = (start: string, end: string, w: { from: string; to: string }) => ({
  start: start < w.from ? w.from : start,
  end: end > w.to ? w.to : end,
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Turn your places, guests and trips into rows of bars, plus the counts and warnings worth surfacing. */
export function buildCalendar(input: CalendarInput): CalendarData {
  const w = span(input.today);
  const rows: CalendarRow[] = [];
  const items: CalendarItem[] = [];
  /** Trip nights with a confirmed place, and with more than one. */
  const covered = new Map<string, string[]>();

  // Your places: each night is booked, requested, blocked or open, in that order of precedence.
  const places = input.places.length
    ? input.places
    : input.guests.length
      ? [{ id: "_place", title: "Your place", open: [], blocked: [] }]
      : [];
  const placeIds = new Set(places.map((p) => p.id));
  const many = places.length > 1;

  for (const place of places) {
    rows.push({ id: place.id, side: "hosting", label: place.title, photo: place.photo });
    const guests = input.guests.filter((g) => (g.placeId && placeIds.has(g.placeId) ? g.placeId : places[0].id) === place.id);
    const byId = new Map(guests.map((g) => [g.id, g]));
    const night = new Map<string, string>();
    const mark = (start: string, end: string, key: (current: string | undefined) => string | null) => {
      const r = clip(start, end, w);
      for (const n of nights(r.start, r.end)) {
        const k = key(night.get(n));
        if (k) night.set(n, k);
      }
    };
    for (const r of place.open) mark(r.start, addDays(r.end, 1), (c) => (c ? null : "open"));
    for (const r of place.blocked) mark(r.start, addDays(r.end, 1), () => "blocked");
    for (const g of guests.filter((g) => g.status === "request"))
      mark(g.start, g.end, (c) => (c?.startsWith("request:") ? `${c},${g.id}` : `request:${g.id}`));
    // A booked guest wins the night; a second booking on the same night is a double booking we still show.
    for (const g of guests.filter((g) => g.status === "booked"))
      mark(g.start, g.end, (c) => (c?.startsWith("booked:") ? `${c},${g.id}` : `booked:${g.id}`));

    for (const run of runs(night)) {
      const [kind, ids = ""] = run.key.split(":");
      const who = ids ? ids.split(",").map((id) => byId.get(id)!) : [];
      const base = { row: place.id, side: "hosting" as const, start: run.start, end: run.end };
      const where = many ? place.title : undefined;
      if (kind === "open") items.push({ ...base, id: `${place.id}:open:${run.start}`, tone: "open", label: "Open", detail: where });
      else if (kind === "blocked")
        items.push({ ...base, id: `${place.id}:blocked:${run.start}`, tone: "blocked", label: "Blocked", detail: where });
      else {
        const first = who[0];
        const label = who.length === 1 ? first.name : `${who.map((g) => g.name.split(" ")[0]).join(" + ")}`;
        items.push({
          ...base,
          id: `${place.id}:${kind}:${run.start}:${ids}`,
          tone: kind === "booked" ? (who.length > 1 ? "overlap" : "booked") : "request",
          label: kind === "request" && who.length > 1 ? plural(who.length, "request") : label,
          detail: [kind === "request" ? "Asked to stay" : null, where, who.length === 1 ? first.source : null]
            .filter(Boolean)
            .join(" · ") || undefined,
          photo: who.length === 1 ? first.photo : null,
          href: who.length === 1 ? first.href : undefined,
        });
      }
    }
  }

  // Your trips: confirmed places are their own bars; pending ones fill nights you have nothing for yet.
  const confirmed = input.stays.filter((s) => s.status === "confirmed" && s.end > s.start);
  const pending = input.stays.filter((s) => s.status === "pending" && s.end > s.start);
  if (confirmed.length || pending.length) {
    rows.push({ id: "_trips", side: "trip", label: "Where you sleep" });
    for (const s of confirmed) for (const n of nights(s.start, s.end)) covered.set(n, [...(covered.get(n) ?? []), s.id]);

    for (const s of confirmed) {
      const clash = [...nights(s.start, s.end)].some((n) => covered.get(n)!.length > 1);
      items.push({
        id: `stay:${s.id}`,
        row: "_trips",
        side: "trip",
        tone: clash ? "overlap" : "stay",
        label: s.title,
        detail: [s.host && `with ${s.host}`, s.where, clash && "overlaps another stay"].filter(Boolean).join(" · ") || undefined,
        photo: s.photo,
        start: s.start,
        end: s.end,
        href: s.href,
      });
    }

    const waiting = new Map<string, string>();
    for (const s of pending)
      for (const n of nights(s.start, s.end)) if (!covered.has(n)) waiting.set(n, [waiting.get(n), s.id].filter(Boolean).join(","));
    const byId = new Map(pending.map((s) => [s.id, s]));
    for (const run of runs(waiting)) {
      const who = run.key.split(",").map((id) => byId.get(id)!);
      items.push({
        id: `pending:${run.start}:${run.key}`,
        row: "_trips",
        side: "trip",
        tone: "pending",
        label: who.length === 1 ? who[0].title : `Waiting on ${who.length} hosts`,
        detail: who.length === 1 ? ["Waiting to hear back", who[0].where].filter(Boolean).join(" · ") : "You applied to a few places",
        photo: who.length === 1 ? who[0].photo : null,
        start: run.start,
        end: run.end,
        href: who.length === 1 ? who[0].href : undefined,
      });
    }

    // Gaps: short stretches with nothing at all, between nights where you have (or might have) a place.
    const touched = [...new Set([...covered.keys(), ...waiting.keys()])].sort();
    for (let i = 1; i < touched.length; i++) {
      const after = addDays(touched[i - 1], 1);
      const gap = nightsBetween(after, touched[i]);
      if (gap > 0 && gap <= MAX_GAP_NIGHTS)
        items.push({
          id: `gap:${after}`,
          row: "_trips",
          side: "trip",
          tone: "gap",
          label: "No place yet",
          detail: `${plural(gap, "night")} between stays`,
          start: after,
          end: touched[i],
        });
    }
  }

  return { today: input.today, rows, items, summary: summarize(input.today, items, covered) };
}

function summarize(today: string, items: CalendarItem[], covered: Map<string, string[]>): CalendarSummary {
  const ahead = items.filter((i) => i.end > today);
  const upcomingNights = (i: CalendarItem) => nightsBetween(i.start < today ? today : i.start, i.end);
  const count = (tone: Tone, side?: CalendarItem["side"]) =>
    ahead.filter((i) => i.tone === tone && (!side || i.side === side)).reduce((n, i) => n + upcomingNights(i), 0);
  const ranges = (tone: Tone, side: CalendarItem["side"]) =>
    ahead
      .filter((i) => i.tone === tone && i.side === side)
      .map((i) => ({ start: i.start, end: i.end, nights: nightsBetween(i.start, i.end) }));
  const next = (pred: (i: CalendarItem) => boolean) =>
    ahead.filter(pred).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
  const booked = [...covered.keys()].filter((n) => n >= today);
  const clashes = runs(new Map(booked.filter((n) => covered.get(n)!.length > 1).map((n) => [n, "clash"])));

  return {
    hosting: {
      bookedNights: count("booked", "hosting") + count("overlap", "hosting"),
      openNights: count("open", "hosting"),
      requests: new Set(
        ahead.filter((i) => i.tone === "request").flatMap((i) => i.id.split(":").at(-1)!.split(",")),
      ).size,
      nextGuest: next((i) => i.side === "hosting" && (i.tone === "booked" || i.tone === "overlap")),
    },
    trips: {
      confirmedNights: booked.length,
      pendingNights: count("pending"),
      gaps: ranges("gap", "trip"),
      overlaps: clashes.map((c) => ({ start: c.start, end: c.end, nights: nightsBetween(c.start, c.end) })),
      nextStay: next((i) => i.side === "trip" && (i.tone === "stay" || i.tone === "overlap")),
    },
  };
}

// ---------------------------------------------------------------------------
// Laying out a month
// ---------------------------------------------------------------------------

export type Segment = {
  item: CalendarItem;
  /** Columns within the week, 0 = Sunday; `to` is exclusive. */
  from: number;
  to: number;
  /** The bar continues from the previous week / into the next one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type Week = {
  days: { date: string; inMonth: boolean }[];
  /** One lane per row that has anything this week (overlapping trips take extra lanes). */
  lanes: { row: CalendarRow; segments: Segment[] }[];
};

/** The weeks of `month` (YYYY-MM), Sunday first, each with its bars split into lanes. */
export function layoutMonth(month: string, rows: CalendarRow[], items: CalendarItem[]): Week[] {
  const first = `${month}-01`;
  const start = addDays(first, -new Date(ms(first)).getUTCDay());
  const next = `${addMonths(month, 1)}-01`;
  const weeks: Week[] = [];

  for (let w0 = start; w0 < next; w0 = addDays(w0, 7)) {
    const w1 = addDays(w0, 7);
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(w0, i);
      return { date, inMonth: monthOf(date) === month };
    });
    const lanes: Week["lanes"] = [];
    for (const row of rows) {
      const rowLanes: Segment[][] = [];
      const segments = items
        .filter((i) => i.row === row.id && i.start < w1 && i.end > w0)
        .sort((a, b) => a.start.localeCompare(b.start) || TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
        .map((item) => ({
          item,
          from: Math.max(0, nightsBetween(w0, item.start)),
          to: Math.min(7, nightsBetween(w0, item.end)),
          continuesBefore: item.start < w0,
          continuesAfter: item.end > w1,
        }));
      for (const s of segments) {
        const lane = rowLanes.find((l) => l.every((o) => o.to <= s.from || o.from >= s.to));
        if (lane) lane.push(s);
        else rowLanes.push([s]);
      }
      for (const l of rowLanes) lanes.push({ row, segments: l });
    }
    weeks.push({ days, lanes });
  }
  return weeks;
}

const TONE_ORDER: Record<Tone, number> = {
  overlap: 0,
  booked: 1,
  stay: 1,
  request: 2,
  pending: 2,
  gap: 3,
  blocked: 4,
  open: 5,
};

/** Everything on one night, for the day detail. */
export function onNight(date: string, items: CalendarItem[]) {
  return items.filter((i) => i.start <= date && i.end > date);
}

/** The month worth opening first: the first gap or double booking, else the next thing coming up, else today's. */
export function focusMonth(data: CalendarData, side?: CalendarItem["side"]) {
  const ahead = data.items
    .filter((i) => i.end > data.today && i.tone !== "open" && (!side || i.side === side))
    .sort((a, b) => a.start.localeCompare(b.start));
  const first = ahead.find((i) => i.tone === "gap" || i.tone === "overlap") ?? ahead[0];
  if (!first || first.start <= data.today) return monthOf(data.today);
  return monthOf(first.start);
}
