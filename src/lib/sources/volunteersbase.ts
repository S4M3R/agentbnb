import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/volunteersbase.browser.js extracts from a project page. */
type VolunteersBaseRaw = {
  id: string;
  url: string;
  title: string;
  location: string | null; // "Ben Lomond, United States", "Willits, CA, United States"
  listLocation: string | null;
  city: string | null; // map pin label, sometimes "Perris, California"
  country: string | null;
  lat: number | null; // host-entered map pin; sometimes wildly off
  lng: number | null;
  verifiedHost: boolean;
  description: string | null;
  photos: string[];
};

/** California: bounding box plus the diagonal eastern border, so Nevada pins don't pass. */
function inCalifornia(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return false;
  if (lat > 42.1 || lat < 32.4 || lng > -114.1 || lng < -124.6) return false;
  return lat >= 39 ? lng <= -120 : lng <= -120 + (39 - lat) * 1.35;
}

const CA_TEXT = /california|\bCA\b/i;
const OTHER_STATE = /\b(nevada|las vegas|reno|oregon|arizona)\b/i;

/** "Perris, California" -> "Perris"; "100 miles north of San Francisco, California" -> null. */
function cityName(raw: VolunteersBaseRaw) {
  const first = (raw.city ?? raw.location ?? "").split(",")[0].trim();
  if (!first || /^(california|usa|united states)$/i.test(first) || /\d+\s*miles|near\s/i.test(first)) return null;
  // Title-case shouty names ("BURNT RANCH").
  return first === first.toUpperCase() ? first.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : first;
}

export const volunteersbase: SourceAdapter = {
  sourceId: "volunteersbase",

  normalize(input) {
    const v = input as VolunteersBaseRaw;
    if (!v?.id || !v.title) return null;

    const text = `${v.title} ${v.location ?? ""} ${v.city ?? ""}`;
    const pinOk = inCalifornia(v.lat, v.lng);
    // Keep California projects only; a pin in-state counts unless the text names another state.
    if (!CA_TEXT.test(text) && !(pinOk && !OTHER_STATE.test(text))) return null;

    const listing: NormalizedListing = {
      externalId: v.id,
      externalUrl: v.url,
      type: "work_exchange",
      title: v.title,
      description: v.description,
      guestExpectations: null,
      houseRules: null,
      neighborhood: null,
      city: cityName(v),
      subregion: null,
      region: "California",
      countryCode: "US",
      lat: pinOk ? v.lat : null,
      lng: pinOk ? v.lng : null,
      locationPrecision: pinOk ? "approximate" : cityName(v) ? "city" : null,
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: [],
      languages: [],
      rating: null,
      attributes: {
        location: v.location,
        verifiedHost: v.verifiedHost,
        // Pins outside California (bad host geocodes) are dropped.
        pinDiscarded: v.lat != null && !pinOk ? { lat: v.lat, lng: v.lng } : undefined,
      },
      photos: v.photos.map((url) => ({ sourceUrl: url })),
      availability: [],
      raw: v,
    };
    return listing;
  },
};

export default volunteersbase;
