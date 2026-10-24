import type { NormalizedListing, SourceAdapter } from "./types";

// Whitelisted record written by scripts/scrapers/homelink.browser.js.
type HomeLinkItem = {
  id: number;
  title: string | null;
  type: string | null;
  isMainResidence: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  sleeps: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carExchange: string | null;
  photos: { url: string; caption: string | null }[];
  description: string | null;
  rules: string | null;
  neighborhood: string | null;
  attractions: string | null;
  amenities: string[];
  settings: string[];
  nearby: string[];
  childrenAllowed: number | null;
  smokingAllowed: number | null;
  petsAllowed: number | null;
  petFreeHome: number | null;
  petCareNeeded: number | null;
  plantCareNeeded: number | null;
  nonSimultaneous: number | null;
  longTerm: number | null;
  hospitalityOffered: number | null;
  homesitOffered: number | null;
  homesitNeeded: number | null;
  youthExchange: number | null;
  listingCreatedAt: string | null;
  completion: number | null;
  referenceCount: number | null;
  user: {
    id: number | null;
    firstName: string | null;
    avatarUrl: string | null;
    languages: string[];
    responseRate: number | null;
    exchanges: number | null;
    verified: boolean | null;
  };
  travelPlans: {
    id: number;
    startDate: string | null;
    endDate: string | null;
    anyDates: boolean;
    anyDestination: boolean;
    destinations: string[];
  }[];
};

const BASE = "https://homelink.org";
const bool = (v: number | null | undefined) => (v == null ? null : v === 1);
const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export const homelink: SourceAdapter = {
  sourceId: "homelink",

  normalize(input) {
    const h = input as HomeLinkItem;
    if (!h?.id) return null;

    const today = new Date().toISOString().slice(0, 10);
    const windows = h.travelPlans
      .map((t) => ({ ...t, startDate: isoDate(t.startDate), endDate: isoDate(t.endDate) }))
      .filter((t): t is typeof t & { startDate: string; endDate: string } => !!t.startDate && !!t.endDate && t.endDate >= today);

    const listing: NormalizedListing = {
      externalId: String(h.id),
      externalUrl: `${BASE}/en/homeexchange/${h.id}/`,
      type: "entire_place",
      title: h.title?.trim() || `Home in ${h.city ?? "California"}`,
      description: h.description?.trim() || null,
      guestExpectations: null,
      houseRules: h.rules?.trim() || null,
      neighborhood: null,
      city: h.city?.trim() || null,
      subregion: null,
      region: h.state ?? null,
      countryCode: h.countryCode ?? (h.country === "United States" ? "US" : null),
      // Rounded to 2 decimals by the scraper (~1km).
      lat: h.lat,
      lng: h.lng,
      locationPrecision: h.lat != null ? "approximate" : null,
      maxGuests: h.sleeps ?? null,
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: h.amenities,
      languages: h.user.languages ?? [],
      rating: null,
      attributes: {
        exchangeType: "home_swap",
        hospitalityOffered: bool(h.hospitalityOffered),
        homeType: h.type ?? null,
        mainResidence: bool(h.isMainResidence),
        bedrooms: h.bedrooms ?? null,
        bathrooms: h.bathrooms ?? null,
        carExchange: h.carExchange === "1" ? true : h.carExchange === "0" ? false : null,
        nonSimultaneous: h.nonSimultaneous ?? null,
        longTermExchange: bool(h.longTerm),
        homesitOffered: bool(h.homesitOffered),
        homesitNeeded: bool(h.homesitNeeded),
        youthExchange: bool(h.youthExchange),
        childrenAllowed: bool(h.childrenAllowed),
        smokingAllowed: bool(h.smokingAllowed),
        petsAllowed: bool(h.petsAllowed),
        petFreeHome: bool(h.petFreeHome),
        petCareNeeded: bool(h.petCareNeeded),
        plantCareNeeded: bool(h.plantCareNeeded),
        settings: h.settings,
        nearby: h.nearby,
        aboutNeighborhood: h.neighborhood?.trim() || null,
        attractions: h.attractions?.trim() || null,
        openToAnyDates: h.travelPlans.some((t) => t.anyDates),
        wishedDestinations: [...new Set(h.travelPlans.flatMap((t) => t.destinations))],
        listedAt: h.listingCreatedAt,
      },
      host: h.user.id
        ? {
            externalId: String(h.user.id),
            displayName: h.user.firstName ?? null,
            avatarUrl: h.user.avatarUrl ?? null,
            languages: h.user.languages ?? [],
            referenceCount: h.referenceCount ?? null,
          }
        : undefined,
      photos: h.photos.map((p) => ({ sourceUrl: p.url, caption: p.caption })),
      // Dates the member wants to travel, i.e. when their home is free to swap.
      availability: windows.map((t) => ({
        externalId: String(t.id),
        startDate: t.startDate,
        endDate: t.endDate,
        attributes: { kind: "travel_dates", destinations: t.destinations },
      })),
      raw: h,
    };
    return listing;
  },
};

export default homelink;
