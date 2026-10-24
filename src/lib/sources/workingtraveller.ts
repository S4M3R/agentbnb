import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/workingtraveller.browser.js extracts per work posting. */
type WorkingTravellerRaw = {
  id: string;
  slug: string | null;
  url: string | null;
  title: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  place: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  dates: string | null;
  barter: string | null;
  skills: string[];
  languages: string[];
  hostId: string | null;
  hostLogin: string | null;
  hostCover: string | null;
  hostAvatar: string | null;
  hostNationality: string | null;
  rating: number | null;
  references: number | null;
  lastLogin: string | null;
  publicDetail: boolean;
};

const BASE = "https://www.workingtraveller.com";
const COUNTRY_CODES: Record<string, string> = { "United States": "US" };
// Postings without a pinned location fall back to the state centroid; treat those as unknown.
const STATE_CENTROIDS = [{ lat: 36.778259, lng: -119.417931 }];

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** "Jan 31 2019" -> "2019-01-31". */
function isoDate(text: string) {
  const m = text.match(/([A-Z][a-z]{2})\w*\s+(\d{1,2})\s+(\d{4})/);
  if (!m || MONTHS[m[1]] == null) return null;
  return new Date(Date.UTC(Number(m[3]), MONTHS[m[1]], Number(m[2]))).toISOString().slice(0, 10);
}

/** "Jan 31 2019 - Mar 28 2019" -> one range; "any time" / open-ended / past ranges -> none. */
function availability(dates: string | null) {
  const [from, to] = dates?.split(/\s+-\s+/) ?? [];
  const startDate = from ? isoDate(from) : null;
  const endDate = to ? isoDate(to) : null;
  const today = new Date().toISOString().slice(0, 10);
  if (!startDate || !endDate || endDate < today) return [];
  return [{ externalId: null, startDate, endDate, attributes: { granularity: "day" } }];
}

const stripLevel = (lang: string) => lang.replace(/\s*-\s*.*$/, "").trim();

export const workingtraveller: SourceAdapter = {
  sourceId: "workingtraveller",

  normalize(input) {
    const w = input as WorkingTravellerRaw;
    if (!w?.id || !w.title) return null;

    const centroid = STATE_CENTROIDS.some((c) => c.lat === w.lat && c.lng === w.lng);
    const lat = centroid ? null : w.lat;
    const lng = centroid ? null : w.lng;
    const country = w.country ?? "United States";

    const listing: NormalizedListing = {
      externalId: w.id,
      externalUrl: w.url ?? `${BASE}/work-search/#wrk-${w.id}`,
      type: "work_exchange",
      title: w.title,
      description: w.description,
      guestExpectations: w.skills.length ? `Skills wanted: ${w.skills.join(", ")}` : null,
      houseRules: null,
      neighborhood: null,
      city: w.city,
      subregion: null,
      region: w.region ?? "California",
      countryCode: COUNTRY_CODES[country] ?? null,
      lat,
      lng,
      locationPrecision: lat != null ? "approximate" : w.city ? "city" : null,
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: [],
      languages: [...new Set(w.languages.map(stripLevel).filter(Boolean))],
      rating: w.rating,
      attributes: {
        skills: w.skills,
        barter: w.barter,
        dates: w.dates,
        place: w.place,
        references: w.references,
        hostLastLogin: w.lastLogin,
        hostNationality: w.hostNationality,
        // Map-only postings: the full posting page is members-only.
        publicDetail: w.publicDetail,
        locationFromStateCentroid: centroid || undefined,
      },
      host: w.hostId
        ? {
            externalId: w.hostId,
            displayName: null,
            profileUrl: w.hostLogin ? `${BASE}/members/${w.hostLogin}/` : null,
            avatarUrl: w.hostAvatar,
            languages: w.languages.map(stripLevel).filter(Boolean),
            referenceCount: w.references,
            rating: w.rating,
          }
        : undefined,
      photos: w.hostCover ? [{ sourceUrl: w.hostCover, caption: "Host cover image" }] : [],
      availability: availability(w.dates),
      raw: w,
    };
    return listing;
  },
};

export default workingtraveller;
