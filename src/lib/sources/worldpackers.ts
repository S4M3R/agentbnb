import type { NormalizedListing, SourceAdapter } from "./types";

/** What the browser scraper extracts from a Worldpackers position page. */
type WorldpackersRaw = {
  id: string;
  url: string;
  title: string;
  hostType: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  workHours: string | null;
  offer: string[];
  get: string[];
  requirements: string[];
  minStay: string | null;
  maxStay: string | null;
  months: { year: number; month: number; status: string }[];
  rating: number | null;
  reviews: number | null;
  photos: string[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const decode = (s: string | null) =>
  s?.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e]).trim() ?? null;

const COUNTRY_CODES: Record<string, string> = { "United States": "US" };

/** "2 weeks" -> 14, "1 month" -> 30, "3 days" -> 3. */
function toNights(text: string | null) {
  const m = text?.match(/(\d+)\s*(day|week|month)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
}

function monthRanges(months: WorldpackersRaw["months"]) {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const open = months
    .filter((m) => /available/.test(m.status) && m.status !== "unavailable")
    .map((m) => ({ idx: m.year * 12 + (m.month - 1), status: m.status }))
    .sort((a, b) => a.idx - b.idx);
  const ranges: { start: number; end: number; status: string }[] = [];
  for (const c of open) {
    const last = ranges.at(-1);
    if (last && last.end + 1 === c.idx && last.status === c.status) last.end = c.idx;
    else ranges.push({ start: c.idx, end: c.idx, status: c.status });
  }
  return ranges.map((r) => ({
    externalId: null,
    startDate: iso(new Date(Date.UTC(Math.floor(r.start / 12), r.start % 12, 1))),
    endDate: iso(new Date(Date.UTC(Math.floor(r.end / 12), (r.end % 12) + 1, 0))),
    attributes: { granularity: "month", hostNeed: r.status.replace("_available", "") },
  }));
}

const ROOM_TYPES = ["Private Room", "Shared Room", "Shared Dorm", "Camping", "Tent", "Van", "Cabin"];

export const worldpackers: SourceAdapter = {
  sourceId: "worldpackers",

  normalize(input) {
    const w = input as WorldpackersRaw;
    if (!w?.id || !w.title) return null;

    const hours = w.workHours?.match(/\d+/)?.[0];
    const room = w.get.find((g) => ROOM_TYPES.some((t) => g.toLowerCase().includes(t.toLowerCase())));
    const skills = w.offer.filter((o) => !/hours per week/i.test(o));
    const notIncluded = w.requirements.findIndex((r) => /what's not included/i.test(r));
    const requirements = notIncluded >= 0 ? w.requirements.slice(0, notIncluded) : w.requirements;

    const listing: NormalizedListing = {
      externalId: w.id,
      externalUrl: w.url,
      type: "work_exchange",
      title: decode(w.title) ?? w.title,
      description: decode(w.description),
      guestExpectations: [hours ? `${hours}h of help per week` : null, skills.length ? skills.join(", ") : null]
        .filter(Boolean)
        .join(". ") || null,
      houseRules: requirements.length ? requirements.join("\n") : null,
      neighborhood: null,
      city: w.city,
      subregion: null,
      region: w.region,
      countryCode: (w.country && COUNTRY_CODES[w.country]) ?? null,
      lat: w.lat,
      lng: w.lng,
      locationPrecision: "approximate",
      maxGuests: null,
      minNights: toNights(w.minStay),
      maxNights: toNights(w.maxStay),
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: w.get.filter((g) => !/^(days off per week|support|verified host|wp safeguard)$/i.test(g)),
      languages: [],
      rating: w.rating,
      attributes: {
        hostType: w.hostType,
        room: room ?? null,
        hoursPerWeek: hours ? Number(hours) : null,
        skills,
        reviews: w.reviews,
        minStay: w.minStay,
        maxStay: w.maxStay,
      },
      photos: w.photos.map((url) => ({ sourceUrl: url })),
      availability: monthRanges(w.months),
      raw: w,
    };
    return listing;
  },
};
