import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/mindmyhouse.browser.js extracts per assignment. */
type MindMyHouseRaw = {
  id: string;
  url: string;
  title: string;
  location: string; // "United States, Loveland, Ohio"
  dates?: string[]; // "21 Nov 2026 - 29 Nov 2026"
  petsSummary?: string | null;
  image?: string | null;
  legendary?: string | null;
  lat?: number | null; // rounded to 2 decimals by the scraper
  lng?: number | null;
  mapLocation?: string | null; // reverse-geocoded place of the map pin
  detail?: {
    title?: string;
    location?: string;
    pets?: string[];
    petsNote?: string | null;
    dates?: { range: string; applicants?: string | null }[];
    testimonials?: string | null;
    facilities?: string | null;
    blurb?: Record<string, string>;
    lastUpdated?: string | null;
    lat?: number | null;
    lng?: number | null;
    photos?: string[];
  };
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "21 Nov 2026" → 2026-11-21 */
function parseDate(s: string) {
  const m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(s.trim());
  const mo = m && MONTHS[m[2].toLowerCase()];
  return m && mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** "21 Nov 2026 to 29 Nov 2026" (detail) or "21 Nov 2026 - 29 Nov 2026" (card) */
function parseRange(s: string): [string, string] | null {
  const [a, b] = s.split(/\s+(?:to|-)\s+/);
  const start = a && parseDate(a);
  const end = b && parseDate(b);
  return start && end ? [start, end] : null;
}

function parseCount(text?: string | null) {
  if (!text) return null;
  if (/\bno\b/i.test(text)) return 0;
  const n = /(\d+)/.exec(text)?.[1];
  return n ? Number(n) : null;
}

export const mindmyhouse: SourceAdapter = {
  sourceId: "mindmyhouse",

  normalize(input) {
    const r = input as MindMyHouseRaw;
    const d = r?.detail;
    if (!r?.id || !r.title) return null;

    const today = new Date().toISOString().slice(0, 10);
    const ranges = (d?.dates?.length ? d.dates : (r.dates ?? []).map((range) => ({ range, applicants: null })))
      .map((x) => ({ range: parseRange(x.range), applicants: x.applicants ?? null }))
      .filter((x): x is { range: [string, string]; applicants: string | null } => !!x.range)
      .filter((x) => x.range[1] >= today);
    if (!ranges.length) return null;

    // "United States, San Francisco, California"
    const [country, city, region] = (d?.location || r.location).split(",").map((s) => s.trim());
    const mapPlace = r.mapLocation?.split(",").map((s) => s.trim())[1];
    const blurb = d?.blurb ?? {};
    const about = blurb["About this assignment"] || null;
    const features = blurb["What are the good features of the property and location"] || null;
    const duties = blurb["What responsibilities are required of the house sitter"] || null;
    const consider = blurb["What does the house sitter need to consider before applying for this assignment"] || null;
    const bringPets = blurb["Can I bring my own pets?"] || null;
    const pets = d?.pets?.length ? d.pets : (r.petsSummary ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    const photos = (d?.photos ?? []).map((url) => ({ sourceUrl: url }));
    if (!photos.length && r.image) photos.push({ sourceUrl: r.image });

    const listing: NormalizedListing = {
      externalId: r.id,
      externalUrl: r.url,
      type: "house_sit",
      title: (d?.title || r.title).replace(/\s+/g, " ").trim(),
      description: [about, features].filter(Boolean).join("\n\n") || null,
      guestExpectations: [duties, consider].filter(Boolean).join("\n\n") || null,
      houseRules: d?.petsNote ?? null,
      // The map pin's place name is often a neighborhood (e.g. "Glen Park" in San Francisco).
      neighborhood: mapPlace && mapPlace !== city && mapPlace !== region ? mapPlace : null,
      city: city || null,
      subregion: null,
      region: region || null,
      countryCode: country === "United States" ? "US" : null,
      // Pin from the site's map, rounded to ~1 km by the scraper.
      lat: d?.lat ?? r.lat ?? null,
      lng: d?.lng ?? r.lng ?? null,
      locationPrecision: "approximate",
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: (d?.facilities ?? "")
        .replace(/^They have\s*/i, "")
        .split(/\n|,|\band\b/)
        .map((s) => s.trim())
        .filter(Boolean),
      languages: [],
      rating: null,
      attributes: {
        pets,
        petsNote: d?.petsNote ?? null,
        bringOwnPets: bringPets,
        canBringPets: bringPets ? /^yes/i.test(bringPets) : null,
        testimonials: parseCount(d?.testimonials),
        legendaryMember: r.legendary ?? null,
        lastUpdated: d?.lastUpdated ?? null,
      },
      // Owner details are login-only on MindMyHouse.
      host: undefined,
      photos,
      availability: ranges.map((x) => ({
        externalId: `${r.id}-${x.range[0]}`,
        startDate: x.range[0],
        endDate: x.range[1],
        attributes: { applicants: parseCount(x.applicants) },
      })),
      raw: r,
    };
    return listing;
  },
};

export default mindmyhouse;
