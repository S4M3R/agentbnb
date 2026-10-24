import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/helpstay.browser.js extracts from a HelpStay stay page. */
type HelpStayRaw = {
  id: string;
  slug: string;
  url: string;
  title: string;
  label: string | null; // "United States, San Francisco Bay Area"
  country: string | null;
  area: string | null;
  hostName: string | null;
  hostTitle: string | null;
  hostProfileId: string | null;
  hostAvatar: string | null;
  hostRating: number | null; // 0-10 stars widget
  hostSummary: string | null;
  hostLanguages: string[];
  responseRate: string | null;
  responseTime: string | null;
  lastLogin: string | null;
  description: string | null;
  stayDuration: string | null; // "min 14 day(s)", "min 1 month(s)"
  minimumAge: string | null;
  places: string | null; // " 2 helpers"
  accommodation: string | null;
  roomType: string | null;
  meals: string | null;
  linen: string | null;
  laundry: string | null;
  airport: string | null;
  helpRequired: string[];
  hours: string[]; // ["28 hours/week"]
  workDays: string[];
  whatElse: string[];
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;
  free: string[];
  photos: string[];
};

const BASE = "https://helpstay.com";
const COUNTRY_CODES: Record<string, string> = { "United States": "US" };

/**
 * HelpStay only gives a free-text area. Resolve known place names to a city
 * centroid (stored as locationPrecision "city") so Bay Area stays get a market.
 * Order matters: more specific names first.
 */
const PLACES: { match: RegExp; city: string; subregion: string | null; lat: number; lng: number }[] = [
  { match: /east bay/i, city: "East Bay", subregion: null, lat: 37.8044, lng: -122.2712 },
  { match: /san francisco bay area|bay area/i, city: "San Francisco Bay Area", subregion: null, lat: 37.7749, lng: -122.4194 },
  { match: /san francisco/i, city: "San Francisco", subregion: "San Francisco County", lat: 37.7749, lng: -122.4194 },
  { match: /oakland/i, city: "Oakland", subregion: "Alameda County", lat: 37.8044, lng: -122.2712 },
  { match: /berkeley/i, city: "Berkeley", subregion: "Alameda County", lat: 37.8716, lng: -122.2727 },
  { match: /vallejo/i, city: "Vallejo", subregion: "Solano County", lat: 38.1041, lng: -122.2566 },
  { match: /walnut creek/i, city: "Walnut Creek", subregion: "Contra Costa County", lat: 37.9101, lng: -122.0652 },
  { match: /santa clara/i, city: "Santa Clara", subregion: "Santa Clara County", lat: 37.3541, lng: -121.9552 },
  { match: /los gatos/i, city: "Los Gatos", subregion: "Santa Clara County", lat: 37.2358, lng: -121.9624 },
  { match: /san jose/i, city: "San Jose", subregion: "Santa Clara County", lat: 37.3382, lng: -121.8863 },
  { match: /palo alto/i, city: "Palo Alto", subregion: "Santa Clara County", lat: 37.4419, lng: -122.143 },
  { match: /santa cruz/i, city: "Santa Cruz", subregion: "Santa Cruz County", lat: 36.9741, lng: -122.0308 },
  { match: /half moon bay/i, city: "Half Moon Bay", subregion: "San Mateo County", lat: 37.4636, lng: -122.4286 },
  { match: /petaluma/i, city: "Petaluma", subregion: "Sonoma County", lat: 38.2324, lng: -122.6367 },
  // A bare county name is too coarse to pin; keep the label, no coordinates.
  { match: /^sonoma$/i, city: "Sonoma", subregion: "Sonoma County", lat: 38.2919, lng: -122.458 },
  { match: /^napa$/i, city: "Napa", subregion: "Napa County", lat: 38.2975, lng: -122.2869 },
  { match: /marin|san rafael/i, city: "San Rafael", subregion: "Marin County", lat: 37.9735, lng: -122.5311 },
  { match: /los angeles/i, city: "Los Angeles", subregion: "Los Angeles County", lat: 34.0522, lng: -118.2437 },
  { match: /san diego/i, city: "San Diego", subregion: "San Diego County", lat: 32.7157, lng: -117.1611 },
  { match: /sacramento/i, city: "Sacramento", subregion: "Sacramento County", lat: 38.5816, lng: -121.4944 },
  { match: /ukiah/i, city: "Ukiah", subregion: "Mendocino County", lat: 39.1502, lng: -123.2078 },
];

/** Areas read most-specific first ("Vallejo, Bay area, San Francisco"): the first part we know wins. */
function resolvePlace(area: string | null) {
  for (const part of area?.split(",").map((s) => s.trim()) ?? []) {
    const hit = PLACES.find((p) => p.match.test(part));
    if (hit) return hit;
  }
  return null;
}

/** "min 14 day(s)" -> 14, "min 1 month(s)" -> 30, "min 2 week(s)" -> 14. */
function toNights(text: string | null) {
  const m = text?.match(/(\d+)\s*(day|week|month|year)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === "day" ? n : unit === "week" ? n * 7 : unit === "month" ? n * 30 : n * 365;
}

const firstInt = (text: string | null | undefined) => {
  const m = text?.match(/\d+/);
  return m ? Number(m[0]) : null;
};

export const helpstay: SourceAdapter = {
  sourceId: "helpstay",

  normalize(input) {
    const h = input as HelpStayRaw;
    if (!h?.id || !h.title) return null;

    const place = resolvePlace(h.area);
    const hours = firstInt(h.hours[0]);
    const today = new Date().toISOString().slice(0, 10);
    const availability =
      h.dateFrom && h.dateTo && h.dateTo >= today
        ? [{ externalId: null, startDate: h.dateFrom, endDate: h.dateTo, attributes: { granularity: "day" } }]
        : [];

    const listing: NormalizedListing = {
      externalId: h.id,
      externalUrl: h.url,
      type: "work_exchange",
      title: h.title,
      description: h.description ?? h.hostSummary,
      guestExpectations:
        [
          hours ? `${hours}h of help per week` : null,
          h.helpRequired.length ? h.helpRequired.join(", ") : null,
          h.workDays.length ? `Work days: ${h.workDays.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(". ") || null,
      houseRules: [h.minimumAge ? `Minimum age: ${h.minimumAge}` : null, ...h.whatElse].filter(Boolean).join("\n") || null,
      neighborhood: null,
      city: place?.city ?? h.area?.split(",")[0].trim() ?? null,
      subregion: place?.subregion ?? null,
      region: "California",
      countryCode: (h.country && COUNTRY_CODES[h.country]) ?? null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      locationPrecision: place || h.area ? "city" : null,
      maxGuests: firstInt(h.places),
      minNights: toNights(h.stayDuration),
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: [
        h.roomType,
        h.meals,
        h.linen === "Yes" ? "Linen/bedding" : null,
        h.laundry === "Yes" ? "Laundry" : null,
      ].filter((a): a is string => Boolean(a)),
      languages: h.hostLanguages,
      rating: h.hostRating != null ? h.hostRating / 2 : null,
      attributes: {
        area: h.area,
        // Coordinates are a city centroid we looked up from the area label, not from HelpStay.
        geocodedFrom: place ? h.area : null,
        hostRatingRaw: h.hostRating,
        accommodation: h.accommodation,
        room: h.roomType,
        meals: h.meals,
        hoursPerWeek: hours,
        helpRequired: h.helpRequired,
        workDays: h.workDays,
        stayDuration: h.stayDuration,
        minimumAge: h.minimumAge,
        closestAirport: h.airport,
        whatElse: h.whatElse,
        responseRate: h.responseRate,
        responseTime: h.responseTime,
        hostLastLogin: h.lastLogin,
      },
      host: h.hostProfileId
        ? {
            externalId: h.hostProfileId,
            displayName: h.hostName,
            profileUrl: `${BASE}/profile/${h.hostProfileId}`,
            avatarUrl: h.hostAvatar,
            languages: h.hostLanguages,
            rating: h.hostRating != null ? h.hostRating / 2 : null,
          }
        : undefined,
      photos: h.photos.map((url) => ({ sourceUrl: url })),
      availability,
      raw: h,
    };
    return listing;
  },
};

export default helpstay;
