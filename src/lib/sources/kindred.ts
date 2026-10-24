import type { NormalizedListing, SourceAdapter } from "./types";

// Shape of `searchHomesPublic.homes[]` as saved by scripts/scrapers/kindred.browser.js.
type KindredHome = {
  id: string;
  title: string | null;
  destination: { id: string; name: string; region: string | null } | null;
  media: { thumbnailUrl: string; type?: string; description?: string | null; altText?: string | null }[];
  availabilitiesWithoutBookedDates: { id: string; startDate: string; endDate: string; minimumNights?: number | null }[];
  bedsCount?: number | null;
  bedroomsCount?: number | null;
  bathrooms?: number | null;
  workspacesCount?: number | null;
  maxGuestsLimit?: number | null;
  petPreference?: string | null;
  petHostingDetails?: string | null;
  isFamilyFriendly?: boolean | null;
  lat: number | null;
  lon: number | null;
  owner?: {
    id: string;
    displayName?: string | null;
    hostResponseMetrics?: { responseRate?: number | null; tier?: string | null } | null;
  } | null;
  amenityDetails?: { amenity: string; category?: string }[];
};

const BASE = "https://livekindred.com";

// Destinations that are areas rather than towns.
const isArea = (name: string) => /\b(County|Area|Mountains)\b/.test(name);

export const kindred: SourceAdapter = {
  sourceId: "kindred",

  normalize(input) {
    const h = input as KindredHome;
    if (!h?.id) return null;

    const dest = h.destination;
    const city = dest && !isArea(dest.name) ? dest.name : null;
    const today = new Date().toISOString().slice(0, 10);
    const windows = (h.availabilitiesWithoutBookedDates ?? []).filter((a) => a.endDate >= today);
    const minNights = windows
      .map((a) => a.minimumNights)
      .filter((n): n is number => typeof n === "number" && n > 0);

    const listing: NormalizedListing = {
      externalId: h.id,
      externalUrl: `${BASE}/home/${h.id}`,
      type: "entire_place",
      title: h.title?.trim() || `Home in ${dest?.name ?? "California"}`,
      // Kindred hides the description from logged-out visitors.
      description: null,
      guestExpectations: null,
      houseRules: null,
      neighborhood: null,
      city,
      subregion: dest && isArea(dest.name) ? dest.name : null,
      region: dest?.region ?? null,
      countryCode: "US",
      // Rounded to 2 decimals by the scraper (~1km).
      lat: h.lat,
      lng: h.lon,
      locationPrecision: h.lat != null ? "approximate" : null,
      maxGuests: h.maxGuestsLimit ?? null,
      minNights: minNights.length ? Math.min(...minNights) : null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: (h.amenityDetails ?? []).map((a) => a.amenity.toLowerCase()),
      languages: [],
      rating: null,
      attributes: {
        exchangeType: "home_swap",
        // Kindred: host a night to earn a night; guests pay cleaning + service fees only.
        creditModel: "night_for_night",
        bedrooms: h.bedroomsCount ?? null,
        beds: h.bedsCount ?? null,
        bathrooms: h.bathrooms ?? null,
        workspaces: h.workspacesCount ?? null,
        petPreference: h.petPreference ?? null,
        petHosting: h.petHostingDetails ?? null,
        familyFriendly: h.isFamilyFriendly ?? null,
        destination: dest?.name ?? null,
        hostResponseTier: h.owner?.hostResponseMetrics?.tier ?? null,
      },
      host: h.owner
        ? {
            externalId: h.owner.id,
            displayName: h.owner.displayName ?? null,
          }
        : undefined,
      photos: (h.media ?? []).map((m) => ({ sourceUrl: m.thumbnailUrl, caption: m.altText ?? m.description ?? null })),
      availability: windows.map((a) => ({
        externalId: a.id,
        startDate: a.startDate,
        endDate: a.endDate,
        attributes: { minimumNights: a.minimumNights ?? null },
      })),
      raw: h,
    };
    return listing;
  },
};

export default kindred;
