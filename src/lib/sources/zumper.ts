import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/zumper.node.ts writes per room: the search card + listing detail (scrubbed). */
type Media = { media_id: number; media_type?: number; width?: number | null; height?: number | null; is_available?: boolean };
type ZumperRaw = {
  url: string;
  scrapedAt?: string;
  listable: {
    listing_id: number;
    feed_name?: string | null;
    brokerage_name?: string | null;
    city?: string | null;
    state?: string | null;
    neighborhood_name?: string | null;
    zipcode?: string | null;
    lat?: number | null;
    lng?: number | null;
    min_price?: number | null;
    max_price?: number | null;
    date_available?: string | null;
    image_ids?: number[];
    title?: string | null;
    short_description?: string | null;
    amenity_tags?: string[];
    building_amenity_tags?: string[];
    min_lease_days?: number | null;
    max_lease_days?: number | null;
    rating?: number | null;
    listed_on?: number | null;
    [k: string]: unknown;
  };
  detail: {
    listing_id: number;
    title?: string | null;
    description?: string | null;
    short_description?: string | null;
    min_price?: number | null;
    price?: number | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    half_bathrooms?: number | null;
    square_feet?: number | null;
    media?: Media[];
    lease_terms?: string | null;
    min_lease_days?: number | null;
    max_lease_days?: number | null;
    date_available?: string | null;
    amenity_tags?: string[];
    building_amenity_tags?: string[];
    deposits?: { min?: number | null; max?: number | null }[] | null;
    fees?: unknown;
    leasing_fee?: number | null;
    has_fees?: boolean;
    pets?: number[];
    pet_policy?: unknown;
    feed_name?: string | null;
    building_name?: string | null;
    listing_location?: { street?: string | null; zipcode?: string | null; city?: string | null; lat?: number | null; lng?: number | null; hasHouseNumber?: boolean };
    neighborhood?: { name?: string | null } | null;
    operator?: { id?: number | null; name?: string | null; applicationFee?: number | null; screeningFee?: number | null } | null;
    [k: string]: unknown;
  };
};

// Feeds that are already ingested from the operator directly (avoid duplicate listings).
const DUPLICATE_FEEDS = new Set(["padsplit", "bungalow"]);

const COUNTY: Record<string, string> = {
  "San Francisco": "San Francisco County",
  Oakland: "Alameda County",
  Berkeley: "Alameda County",
  Hayward: "Alameda County",
  Fremont: "Alameda County",
  "San Jose": "Santa Clara County",
  Milpitas: "Santa Clara County",
  "Santa Clara": "Santa Clara County",
  Sunnyvale: "Santa Clara County",
  "Redwood City": "San Mateo County",
  "Menlo Park": "San Mateo County",
  "Daly City": "San Mateo County",
  "San Mateo": "San Mateo County",
  Vallejo: "Solano County",
  Crockett: "Contra Costa County",
  Pittsburg: "Contra Costa County",
  Brentwood: "Contra Costa County",
  Concord: "Contra Costa County",
  Richmond: "Contra Costa County",
  Novato: "Marin County",
};

const STREET = "(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ct|Court|Way|Ln|Lane|Ter|Terrace|Cir|Circle|Pl|Place|Pkwy|Hwy)";
const HOUSE_NUMBER = new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+((?:[A-Z0-9][\\w.'-]*\\s+){1,4}${STREET})\\b\\.?`, "g");
const redact = (s: string | null | undefined) =>
  s
    ?.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(\s*ext\.?\s*\d+)?/gi, "[phone removed]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email removed]")
    // Rooms are in people's homes: keep the street, drop the house number.
    .replace(HOUSE_NUMBER, "$1")
    .replace(/\bProperty Id:\s*\d+\s*/gi, "")
    .trim() || null;

/** Apply `redact` to every string in a JSON value; drop address-slug URL fields. */
const SLUG_KEYS = new Set(["pa_url", "pl_url", "padmapper_url", "provider_url", "phone", "listing_agents"]);
function deepRedact(v: unknown): unknown {
  if (typeof v === "string") return redact(v) ?? v;
  if (Array.isArray(v)) return v.map(deepRedact);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SLUG_KEYS.has(k)).map(([k, x]) => [k, deepRedact(x)]));
  }
  return v;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const round = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
/** "2026/10/15" or "2026-10-15" → "2026-10-15". */
const ymd = (s: string | null | undefined) => (s ? s.replace(/\//g, "-").slice(0, 10) : null);
/** Titles that are just an address, a cross-street, a city, or a couple of words. */
const weakTitle = (s: string) =>
  s.length < 20 || /^\s*\d+\s+\S+/.test(s) || /\b(CA|California)(\s+\d{5})?\s*$/.test(s) || /^room for rent$/i.test(s);

export const zumper: SourceAdapter = {
  sourceId: "zumper",

  normalize(input) {
    const r = input as ZumperRaw;
    const l = r?.listable;
    const d = r?.detail;
    if (!l?.listing_id || !d || !r.url) return null;
    if (DUPLICATE_FEEDS.has(String(l.feed_name ?? d.feed_name ?? ""))) return null;

    const monthly = d.price ?? d.min_price ?? l.min_price;
    if (!monthly || monthly <= 0) return null;

    const now = r.scrapedAt ? new Date(r.scrapedAt) : new Date();
    const today = iso(now);
    const available = ymd(d.date_available ?? l.date_available);
    const start = available && available > today ? available : today;
    const end = iso(new Date(Date.parse(start) + 365 * 864e5));

    const city = l.city ?? d.listing_location?.city ?? null;
    const hood = l.neighborhood_name ?? d.neighborhood?.name ?? null;
    const where = hood && city ? `${hood}, ${city}` : (city ?? "the Bay Area");
    const rawTitle = (d.title ?? l.title ?? "").trim();
    const title = rawTitle && !weakTitle(rawTitle) ? redact(rawTitle)! : `Private room in ${where}`;

    const tags = [...new Set([...(d.amenity_tags ?? l.amenity_tags ?? []), ...(d.building_amenity_tags ?? l.building_amenity_tags ?? [])])];
    const text = `${d.description ?? ""} ${tags.join(" ")}`;
    const furnished = /\bunfurnished\b/i.test(text) ? false : /\bfurnished\b/i.test(text) ? true : null;
    const utilitiesIncluded = tags.includes("Utilities Included") || /utilities (are )?included|all utilities/i.test(d.description ?? "") || null;
    const sharedRoom = /\bshared (bed)?room\b|\bbunk\b/i.test(`${rawTitle} ${d.description ?? ""}`);

    const minLease = d.min_lease_days ?? l.min_lease_days ?? null;
    const maxLease = d.max_lease_days ?? l.max_lease_days ?? null;
    const photos = (d.media?.length ? d.media.filter((m) => m.media_type !== 2 && m.is_available !== false) : (l.image_ids ?? []).map((id) => ({ media_id: id }) as Media))
      .slice(0, 25)
      .map((m) => ({ sourceUrl: `https://img.zumpercdn.com/${m.media_id}/1280x960`, width: m.width ?? null, height: m.height ?? null }));

    const lat = d.listing_location?.lat ?? l.lat ?? null;
    const lng = d.listing_location?.lng ?? l.lng ?? null;
    const operatorName = d.operator?.name || l.brokerage_name || null;

    const listing: NormalizedListing = {
      externalId: String(l.listing_id),
      externalUrl: r.url,
      type: sharedRoom ? "shared_room" : "private_room",
      title,
      description: redact(d.description ?? d.short_description ?? l.short_description),
      guestExpectations: null,
      houseRules: null,
      neighborhood: city === "San Francisco" || city === "Oakland" || city === "San Jose" ? hood : null,
      city,
      subregion: city ? (COUNTY[city] ?? null) : null,
      region: "California",
      countryCode: "US",
      lat: round(lat),
      lng: round(lng),
      locationPrecision: lat != null ? "approximate" : null,
      maxGuests: 1,
      minNights: minLease && minLease > 0 ? minLease : null,
      maxNights: maxLease && maxLease > 0 ? maxLease : null,
      priceModel: "paid",
      priceAmountCents: Math.round(monthly * 100),
      pricePeriod: "month",
      currency: "USD",
      amenities: tags,
      languages: [],
      rating: null,
      attributes: {
        feed: l.feed_name ?? d.feed_name ?? null,
        operator: operatorName,
        bedroomsInHome: d.bedrooms != null && d.bedrooms > 0 ? d.bedrooms : null,
        bathrooms: d.bathrooms != null && d.bathrooms >= 0 ? d.bathrooms + (d.half_bathrooms ? d.half_bathrooms * 0.5 : 0) : null,
        squareFeet: d.square_feet && d.square_feet > 0 && d.square_feet < 1e6 ? d.square_feet : null,
        zipcode: l.zipcode ?? d.listing_location?.zipcode ?? null,
        street: d.listing_location?.street ?? null,
        furnished,
        utilitiesIncluded,
        deposit: d.deposits?.[0]?.min ?? null,
        deposits: d.deposits ?? null,
        fees: d.fees ?? null,
        hasFees: d.has_fees ?? null,
        leasingFee: d.leasing_fee ?? null,
        applicationFee: d.operator?.applicationFee ?? null,
        screeningFee: d.operator?.screeningFee ?? null,
        leaseTerms: d.lease_terms ?? null,
        minLeaseDays: minLease,
        maxLeaseDays: maxLease,
        petsAllowed: d.pets?.length ? d.pets : null,
        dateAvailable: available,
        listedOn: l.listed_on ? iso(new Date(l.listed_on * 1000)) : null,
        zumperRating: l.rating ?? null,
      },
      host: d.operator?.id
        ? { externalId: String(d.operator.id), displayName: d.operator.name ?? null }
        : undefined,
      photos,
      availability: [
        {
          externalId: null,
          startDate: start,
          endDate: end,
          attributes: { openEnded: true, availableNow: start === today, dateAvailable: available },
        },
      ],
      raw: deepRedact({
        listable: { ...l, lat: round(l.lat), lng: round(l.lng) },
        detail: { ...d, listing_location: { ...d.listing_location, lat: round(lat), lng: round(lng) } },
      }),
    };
    return listing;
  },
};

export default zumper;
