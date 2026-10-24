import type { NormalizedListing, SourceAdapter } from "./types";

/** What the browser scraper extracts from a Workaway host page. */
type WorkawayRaw = {
  id: string;
  url: string;
  title: string;
  lat: number | null;
  lng: number | null;
  region?: string | null;
  sections: Record<string, string>;
  photos: { url: string; caption?: string | null }[];
  stats: {
    hostRating?: number | null; // percent
    replyRate?: number | null; // percent
    feedbackCount?: number | null;
    lastReplied?: string | null;
    idVerified?: boolean;
  };
  minStay?: string | null;
  calendar: { year: number; month: number; status: "green" | "yellow" | "red" }[];
};

function inCalifornia(lat: number | null, lng: number | null) {
  return lat != null && lng != null && lat > 32.5 && lat < 42.1 && lng > -124.5 && lng < -114.1;
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function parseGuests(text?: string) {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const n = Number.parseInt(t, 10);
  if (!Number.isNaN(n)) return n;
  const word = Object.keys(WORDS).find((w) => t.startsWith(w) || t.startsWith(`more than ${w}`));
  if (!word) return null;
  return t.startsWith("more than") ? WORDS[word] + 1 : WORDS[word];
}

function lines(text?: string) {
  return (text ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Collapse consecutive available months into date ranges. */
function monthRanges(calendar: WorkawayRaw["calendar"]) {
  const now = new Date();
  const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const open = calendar
    .filter((c) => c.status !== "red")
    .map((c) => ({ idx: c.year * 12 + (c.month - 1), status: c.status }))
    .filter((c) => c.idx >= thisMonth)
    .sort((a, b) => a.idx - b.idx);

  const ranges: { start: number; end: number; status: string }[] = [];
  for (const c of open) {
    const last = ranges.at(-1);
    if (last && last.end + 1 === c.idx && last.status === c.status) last.end = c.idx;
    else ranges.push({ start: c.idx, end: c.idx, status: c.status });
  }

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return ranges.map((r) => ({
    externalId: null,
    startDate: iso(new Date(Date.UTC(Math.floor(r.start / 12), r.start % 12, 1))),
    endDate: iso(new Date(Date.UTC(Math.floor(r.end / 12), (r.end % 12) + 1, 0))),
    attributes: { granularity: "month", hostNeed: r.status === "green" ? "needed" : "possible" },
  }));
}

export const workaway: SourceAdapter = {
  sourceId: "workaway",

  normalize(input) {
    const w = input as WorkawayRaw;
    if (!w?.id || !w.title) return null;
    const s = w.sections ?? {};

    const languages = lines(s["Languages spoken"] ?? s["Languages"]).map((l) => l.split(":")[0].trim());
    const helpTypes = lines(s["Types of help and learning opportunities"]);
    const moreInfo = lines(s["A little more information"]);

    const listing: NormalizedListing = {
      externalId: w.id,
      externalUrl: w.url,
      type: "work_exchange",
      title: w.title.trim(),
      description: s["Description"] || null,
      guestExpectations: [s["Help"], helpTypes.length ? `Types of help: ${helpTypes.join(", ")}` : null]
        .filter(Boolean)
        .join("\n\n") || null,
      houseRules: null,
      neighborhood: null,
      city: null,
      subregion: null,
      // The list page's region only applies to hosts actually inside it.
      region: inCalifornia(w.lat, w.lng) ? (w.region ?? null) : null,
      countryCode: "US",
      lat: w.lat,
      lng: w.lng,
      locationPrecision: "approximate",
      maxGuests: parseGuests(s["How many Workawayers can stay?"]),
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: moreInfo,
      languages,
      rating: w.stats?.hostRating != null ? Math.round((w.stats.hostRating / 20) * 10) / 10 : null,
      attributes: {
        accommodation: s["Accommodation"] || null,
        helpTypes,
        culturalExchange: s["Cultural exchange and learning opportunities"] || null,
        whatElse: s["What else ..."] || null,
        digitalNomads: s["Can host digital nomads"] || null,
        pets: s["My animals / pets"] || null,
        camperVanParking: s["Space for parking camper vans"] || null,
        needsHelpNow: "Host is looking for help immediately" in s,
        minStay: w.minStay ?? null,
        replyRate: w.stats?.replyRate ?? null,
        lastReplied: w.stats?.lastReplied ?? null,
        idVerified: w.stats?.idVerified ?? null,
      },
      host: {
        externalId: w.id,
        profileUrl: w.url,
        languages,
        referenceCount: w.stats?.feedbackCount ?? null,
        rating: w.stats?.hostRating ?? null,
      },
      photos: w.photos.map((p) => ({ sourceUrl: p.url, caption: p.caption ?? null })),
      availability: monthRanges(w.calendar ?? []),
      raw: w,
    };
    return listing;
  },
};
