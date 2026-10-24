import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/housecarers.browser.js extracts per sit. */
type HouseCarersRaw = {
  id: string;
  username?: string;
  postedAt?: string | null; // YYYY-MM-DD, from the public list
  locationOrder?: string | null; // "<Country><State><City>" sort key, e.g. "United StatesCaliforniaBrentwood"
  locationText?: string;
  startDate?: string | null; // YYYY-MM-DD, from the public list
  term?: string;
  pets?: string;
  headline?: string;
  title?: string;
  updatedAt?: string | null; // "Oct 20,2026"
  applications?: number;
  locationLines?: string[]; // ["Shadow Lakes, Brentwood, Brentwood", "Contra Costa County,California United States"]
  lat?: number | null;
  lng?: number | null;
  from?: string | null; // "Oct 25,26"
  to?: string | null;
  days?: number | null;
  termLabel?: string | null;
  description?: string;
  sections?: Record<string, string>;
  verifiedSupporter?: boolean;
  avatar?: string | null;
  photos?: { url: string; caption?: string | null }[];
};

const BASE = "https://www.housecarers.com";

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
  "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
].sort((a, b) => b.length - a.length); // longest first: "West Virginia" before "Virginia"

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Oct 25,26" or "Oct 20,2026" → "2026-10-25". */
function parseDate(s?: string | null) {
  const m = s?.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{2}|\d{4})$/);
  const month = m && MONTHS[m[1].toLowerCase()];
  if (!m || !month) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${month}-${m[2].padStart(2, "0")}`;
}

function titleCase(s: string) {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}

/** Split the list's "<Country><State><City>" key; only US is handled. */
function splitLocation(order?: string | null) {
  if (!order?.startsWith("United States")) return null;
  const rest = order.slice("United States".length);
  const state = US_STATES.find((s) => rest.startsWith(s));
  if (!state) return { region: null, city: rest || null };
  return { region: state, city: titleCase(rest.slice(state.length)) || null };
}

function csv(s?: string) {
  return (s ?? "")
    .replace(/\.$/, "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const HOME_TYPE = /\b(house|condo|apartment|flat|unit|cottage|villa|farm|cabin|townhouse|bungalow|ranch)\b/i;
// Gallery shots of the homeowner themselves aren't listing photos.
const PERSON_CAPTION = /^(homeowner|myself|me|us|owner|owners|the owners?)$/i;

// Map pins are homeowner-placed and may sit on the house itself: keep ~1 km precision only.
const round2 = (n: number) => Math.round(n * 100) / 100;

export const houseCarers: SourceAdapter = {
  sourceId: "housecarers",

  normalize(input) {
    const r = input as HouseCarersRaw;
    if (!r?.id || !(r.title || r.headline)) return null;
    const loc = splitLocation(r.locationOrder);
    if (!loc) return null;

    const [areaLine = "", countyLine = ""] = r.locationLines ?? [];
    const area = areaLine.split(",")[0]?.trim();
    const neighborhood = area && loc.city && area.toLowerCase() !== loc.city.toLowerCase() ? area : null;
    const countyPart = countyLine.includes(",") ? countyLine.split(",")[0].trim() : null;
    const subregion = countyPart && countyPart.toLowerCase() !== loc.city?.toLowerCase() ? countyPart : null;

    const s = r.sections ?? {};
    const features = csv(s["Housesit Features"]);
    const homeType = features.length && HOME_TYPE.test(features[0]) ? features[0] : null;

    const lat = r.lat != null && Number.isFinite(r.lat) ? round2(r.lat) : null;
    const lng = r.lng != null && Number.isFinite(r.lng) ? round2(r.lng) : null;

    const startDate = r.startDate || parseDate(r.from);
    const endDate = parseDate(r.to) ?? startDate;
    const today = new Date().toISOString().slice(0, 10);
    const availability =
      startDate && endDate && endDate >= today
        ? [
            {
              externalId: null,
              startDate,
              endDate,
              attributes: { days: r.days ?? null, term: r.termLabel ?? r.term ?? null, applications: r.applications ?? null },
            },
          ]
        : [];

    const url = `${BASE}/homeowner-profile.cfm?mem=${r.id}`;

    const listing: NormalizedListing = {
      externalId: String(r.id),
      externalUrl: url,
      type: "house_sit",
      title: (r.title || r.headline || "").trim(),
      description: r.description?.trim() || null,
      guestExpectations: null,
      houseRules: null,
      neighborhood,
      city: loc.city,
      subregion,
      region: loc.region,
      countryCode: "US",
      lat,
      lng,
      locationPrecision: lat != null ? "approximate" : "city",
      maxGuests: null,
      minNights: r.days ?? null,
      maxNights: r.days ?? null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: homeType ? features.slice(1) : features,
      languages: [],
      rating: null,
      attributes: {
        headline: r.headline ?? null,
        homeType,
        pets: csv(s["Pet / Animal Care"] ?? r.pets),
        breeds: s["Breed(s)"] ?? null,
        nearby: csv(s.Nearby),
        locale: csv(s.Locale),
        term: r.termLabel ?? r.term ?? null,
        applications: r.applications ?? null,
        postedAt: r.postedAt ?? null,
        updatedAt: parseDate(r.updatedAt),
        verifiedSupporter: r.verifiedSupporter ?? false,
      },
      host: {
        externalId: String(r.id),
        displayName: r.username ?? null,
        profileUrl: url,
        avatarUrl: r.avatar ?? null,
      },
      photos: (r.photos ?? [])
        .filter((p) => !PERSON_CAPTION.test(p.caption?.trim() ?? ""))
        .map((p) => ({ sourceUrl: p.url, caption: p.caption || null })),
      availability,
      raw: { ...r, lat, lng, locationLines: undefined },
    };

    return listing;
  },
};

export default houseCarers;
