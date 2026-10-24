import type { NormalizedListing, SourceAdapter } from "./types";

/** What the browser scraper extracts from HelpX's public listing API. */
type HelpxRaw = {
  id: number;
  applicationUserId: number;
  friendlyUrl: string;
  url: string;
  listingName: string | null;
  listingTypeName: string | null;
  countryName: string | null;
  regionName: string | null;
  city: string | null;
  suburb: string | null;
  latitude: number | null;
  longitude: number | null;
  listingDescription: string | null;
  listingAccommodation: string | null;
  allYear: string | null;
  exchangeType: string | null;
  contributionAmount: number | string | null;
  landArea: string | null;
  organicStatus: string | null;
  isOrganic: boolean | null;
  educationOffered: string | null;
  isPremium: boolean | null;
  createdOn: string | null;
  lastUpdated: string | null;
  lastLogin: string | null;
  reviewsReceived: number | null;
  averageRating: number | null;
  images: { small: string; medium: string; big: string }[];
  mainImageUrl: string | null;
  facilities: string[];
  culturals: string[];
  languages: string[];
};

/**
 * HelpX only exposes a free-text city publicly (coordinates need login), so
 * Bay Area cities are placed at their centroid to get them into the market.
 * Keys are lowercased city names as hosts typed them.
 */
const CITY_CENTROIDS: Record<string, [number, number]> = {
  // Inside the sf-bay-area bounds
  "san francisco": [37.7749, -122.4194],
  oakland: [37.8044, -122.2712],
  berkeley: [37.8716, -122.2727],
  richmond: [37.9358, -122.3477],
  "walnut creek": [37.9101, -122.0652],
  "san jose": [37.3382, -121.8863],
  "palo alto": [37.4419, -122.143],
  "santa cruz": [36.9741, -122.0308],
  aptos: [36.9772, -121.8994],
  "boulder creek": [37.1261, -122.1222],
  napa: [38.2975, -122.2869],
  sonoma: [38.2919, -122.458],
  petaluma: [38.2324, -122.6367],
  "san rafael": [37.9735, -122.5311],
  "bel marin keys": [38.0849, -122.51],
  "point reyes station": [38.0691, -122.8069],
  "mill valley": [37.906, -122.545],
  // Just outside the bounds (kept so distance queries still work)
  "santa rosa": [38.4405, -122.7141],
  sebastopol: [38.4021, -122.8239],
  vacaville: [38.3566, -121.9877],
  freedom: [36.9352, -121.7719],
  hollister: [36.8525, -121.4016],
  "san juan bautista": [36.8455, -121.538],
  cloverdale: [38.8055, -123.0172],
  annapolis: [38.7213, -123.3681],
};

const STATE_CODES: Record<string, string> = { California: "CA" };

/** "Santa Ysabel, CA" -> "Santa Ysabel". */
function cleanCity(city: string | null) {
  const c = city?.trim().replace(/\s+/g, " ").replace(/,\s*(ca|california)$/i, "");
  return c ? c.replace(/\b([a-z])/g, (ch) => ch.toUpperCase()) : null;
}

function centroid(city: string | null) {
  return city ? (CITY_CENTROIDS[city.toLowerCase()] ?? null) : null;
}

/** "1 only" -> 1, "1 or 2" / "1 or couple" -> 2, "up to 3 or more" -> 3, "3-5" -> 5. */
function parseGuests(text: string | null) {
  if (!text) return null;
  const nums = text.match(/\d+/g)?.map(Number) ?? [];
  if (/couple/i.test(text)) nums.push(2);
  return nums.length ? Math.max(...nums) : null;
}

/** "All Year Round" is free text on HelpX: "Yes", "Year Round", "Any time!", "May thru September"... */
function isAllYear(text: string | null) {
  return !!text && /^\s*(yes|all year|year round|any ?time)/i.test(text);
}

/** HelpX has no calendar; "All Year Round: Yes" becomes one rolling 12-month range. */
function availability(allYear: string | null) {
  if (!isAllYear(allYear)) return [];
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [
    {
      externalId: null,
      startDate: iso(start),
      endDate: iso(end),
      attributes: { granularity: "year-round", note: "Host lists 'All Year Round'; message host for dates" },
    },
  ];
}

export const helpx: SourceAdapter = {
  sourceId: "helpx",

  normalize(input) {
    const h = input as HelpxRaw;
    if (!h?.id || !h.friendlyUrl) return null;

    const city = cleanCity(h.city);
    const siteCoords =
      h.latitude != null && h.longitude != null ? ([h.latitude, h.longitude] as [number, number]) : null;
    const coords = siteCoords ?? centroid(city);
    const state = h.regionName ? (STATE_CODES[h.regionName] ?? h.regionName) : null;
    const kind = h.listingTypeName?.trim() || "Host";

    const photos: NormalizedListing["photos"] = [];
    const seen = new Set<string>();
    for (const url of [...h.images.map((i) => i.big || i.medium), h.mainImageUrl]) {
      if (!url) continue;
      const key = url.toLowerCase().replace(/\/(medium|large|thumb)\//, "/");
      if (seen.has(key)) continue;
      seen.add(key);
      photos.push({ sourceUrl: url });
    }

    const listing: NormalizedListing = {
      externalId: String(h.id),
      externalUrl: h.url,
      type: "work_exchange",
      title: h.listingName?.trim() || `${kind}${city ? ` in ${city}${state ? `, ${state}` : ""}` : ""}`,
      description: h.listingDescription?.trim() || null,
      guestExpectations: h.exchangeType ? `Exchange: ${h.exchangeType}` : null,
      houseRules: null,
      // `suburb` is free text and sometimes a street hint; not stored as a field.
      neighborhood: null,
      city,
      subregion: null,
      region: h.regionName ?? null,
      countryCode: h.countryName === "United States" ? "US" : null,
      lat: coords?.[0] ?? null,
      lng: coords?.[1] ?? null,
      locationPrecision: siteCoords ? "approximate" : "city",
      maxGuests: parseGuests(h.listingAccommodation),
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: h.facilities ?? [],
      languages: h.languages ?? [],
      rating: h.averageRating ?? null,
      attributes: {
        hostType: h.listingTypeName,
        exchangeType: h.exchangeType,
        accommodates: h.listingAccommodation,
        allYear: isAllYear(h.allYear),
        season: h.allYear?.trim() || null,
        culturalExchange: h.culturals ?? [],
        contributionAmount: h.contributionAmount ?? null,
        landArea: h.landArea || null,
        organicStatus: h.organicStatus || null,
        isOrganic: h.isOrganic ?? null,
        educationOffered: h.educationOffered ?? null,
        isPremium: h.isPremium ?? null,
        lastUpdated: h.lastUpdated,
        lastLogin: h.lastLogin,
        coordsFrom: siteCoords ? "site" : coords ? "city-centroid" : null,
      },
      host: {
        externalId: String(h.applicationUserId ?? h.id),
        profileUrl: h.url,
        languages: h.languages ?? [],
        referenceCount: h.reviewsReceived ?? null,
        rating: h.averageRating ?? null,
        memberSince: h.createdOn ? new Date(h.createdOn) : null,
      },
      photos,
      availability: availability(h.allYear),
      raw: { ...h, suburb: undefined },
    };
    return listing;
  },
};

export default helpx;
