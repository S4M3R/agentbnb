import type { NormalizedListing, SourceAdapter } from "./types";

// Search card + parsed listing page, as written by scripts/scrapers/intervac.browser.js.
type IntervacItem = {
  id: string;
  city: string | null;
  country: string | null;
  headline: string | null;
  exchangeDatesText: string | null;
  sleeps: number | null;
  adults: number | null;
  children: number | null;
  exchanges: string | null;
  hasDetail: boolean;
  listingNumber?: string | null;
  title?: string | null;
  description?: string | null;
  overview?: string[];
  property?: Record<string, string | null> | string[] | null;
  houseRules?: Record<string, string | null> | string[] | null;
  vehicles?: Record<string, string | null> | string[] | null;
  essentials?: string[] | Record<string, string | null> | null;
  features?: string[] | Record<string, string | null> | null;
  accessibility?: string[] | Record<string, string | null> | null;
  neighborhood?: string | null;
  wishlist?: string[];
  status?: string | null;
  alwaysOpen?: boolean;
  periods?: { id: string; startDate: string; endDate: string; lengthOfStay: string | null; flexible: string | null }[];
  lat?: number | null;
  lng?: number | null;
  photos?: { url: string; caption: string | null }[];
  host?: { id: string | null; firstName: string | null } | null;
  referenceCount?: number;
};

const BASE = "https://us.intervac-homeexchange.com";
const COUNTRY_CODES: Record<string, string> = { USA: "US", "United States": "US" };

const asRecord = (v: IntervacItem["property"]) => (v && !Array.isArray(v) ? v : {});
const asList = (v: IntervacItem["essentials"]) => (Array.isArray(v) ? v : []);
const yesNo = (v: string | null | undefined) => (v === "Yes" ? true : v === "No" ? false : null);
const num = (v: string | null | undefined) => {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const EXCHANGE_TYPES = /home exchange|exchange|hospitality|rental|youth/i;

export const intervac: SourceAdapter = {
  sourceId: "intervac",

  normalize(input) {
    const h = input as IntervacItem;
    if (!h?.id) return null;

    const property = asRecord(h.property);
    const rules = asRecord(h.houseRules);
    const vehicles = asRecord(h.vehicles);
    const overview = h.overview ?? [];
    const exchangeTypes = overview.filter((o) => EXCHANGE_TYPES.test(o));
    const hospitalityOnly =
      exchangeTypes.some((t) => /hospitality/i.test(t)) && !exchangeTypes.some((t) => /home exchange/i.test(t));
    const today = new Date().toISOString().slice(0, 10);
    // "Not available for exchange" listings keep their periods on the page; ignore them.
    const open = !/not available/i.test(`${h.status ?? ""} ${h.exchangeDatesText ?? ""}`);
    const periods = open ? (h.periods ?? []).filter((p) => p.endDate >= today) : [];
    const ruleText = Object.entries(rules)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    const car = num(vehicles["Use/Exchange of car"]);

    const listing: NormalizedListing = {
      externalId: h.id,
      externalUrl: `${BASE}/listings/${h.id}`,
      type: hospitalityOnly ? "private_room" : "entire_place",
      title: (h.title ?? h.headline)?.trim() || `Home in ${h.city ?? "California"}`,
      description: h.description?.trim() || null,
      guestExpectations: null,
      houseRules: ruleText || null,
      neighborhood: null,
      city: h.city?.trim() || null,
      subregion: null,
      region: null,
      countryCode: (h.country && COUNTRY_CODES[h.country]) ?? null,
      // Rounded to 2 decimals by the scraper (~1km).
      lat: h.lat ?? null,
      lng: h.lng ?? null,
      locationPrecision: h.lat != null ? "approximate" : null,
      maxGuests: h.sleeps ?? num(property["Sleeping Capacity"]),
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: [...asList(h.essentials), ...asList(h.features), ...asList(h.accessibility)]
        .filter((a) => a !== "Not applicable")
        .map(slug),
      languages: [],
      rating: null,
      attributes: {
        exchangeType: hospitalityOnly ? "hospitality" : "home_swap",
        exchangeTypes,
        listingNumber: h.listingNumber ?? null,
        homeType: overview.find((o) => /^(House|Flat|Apartment|Villa|Cottage|Chalet|Bungalow|Farm|Boat)/i.test(o)) ?? null,
        overview,
        bedrooms: num(property["Bedrooms"]),
        bathrooms: num(property["Bathrooms"]),
        livingArea: property["Living Area"] ?? null,
        adults: h.adults ?? null,
        children: h.children ?? null,
        childrenWelcome: yesNo(rules["Small children are welcome"]),
        petsWelcome: yesNo(rules["Pets are welcome"]),
        nonSmoking: yesNo(rules["Non-smoking house"]),
        petCareWanted: yesNo(rules["Pet care wanted"]),
        carNecessary: yesNo(rules["Car necessary"]),
        carIncluded: car == null ? null : car > 0,
        openForExchange: open,
        alwaysOpen: open ? (h.alwaysOpen ?? null) : false,
        exchangeDatesText: h.exchangeDatesText ?? null,
        aboutNeighborhood: h.neighborhood ?? null,
        wishedDestinations: h.wishlist ?? [],
        memberLevel: h.exchanges ?? null,
        detailAvailable: h.hasDetail,
      },
      host: h.host?.id
        ? {
            externalId: h.host.id,
            displayName: h.host.firstName ?? null,
            profileUrl: `${BASE}/profiles/${h.host.id}`,
            referenceCount: h.referenceCount ?? null,
          }
        : undefined,
      photos: (h.photos ?? []).map((p) => ({ sourceUrl: p.url, caption: p.caption })),
      availability: periods.map((p) => ({
        externalId: p.id,
        startDate: p.startDate,
        endDate: p.endDate,
        attributes: { lengthOfStay: p.lengthOfStay, flexible: p.flexible },
      })),
      raw: h,
    };
    return listing;
  },
};

export default intervac;
