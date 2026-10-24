import type { NormalizedListing, SourceAdapter } from "./types";

// Record shape written by scripts/scrapers/homeexchange.browser.js (search
// summary merged with /v1/homes/:id detail).
type HeItem = {
  id: number;
  title: string | null;
  description: string | null;
  aboutNeighborhood: string | null;
  otherInfo: string | null;
  isPrivateRoom: boolean | null;
  sharedPart: number | null;
  homeType: number | null;
  residenceType: number | null;
  capacity: number | null;
  minNights: number | null;
  guestPointsPerNight: number | null;
  exchangeCount: number | null;
  isVerified: boolean;
  isCollection: boolean | null;
  prefersReciprocal: boolean | null;
  globalRating: number | null;
  size: {
    size?: number;
    localized_size?: number;
    size_unit?: string;
    bedroom_nb?: number;
    bathroom_nb?: number;
    [bed: string]: unknown;
  } | null;
  features: Record<string, number> | null;
  lat: number | null;
  lng: number | null;
  admins: { country?: string; admin1?: string | null; admin2?: string | null; admin3?: string | null } | null;
  user: {
    id: number;
    firstName: string | null;
    avatarUrl: string | null;
    responseRate: number | null;
    isVerified: boolean | null;
    exchanges: number | null;
    rating: number | null;
  } | null;
  images: string[];
  hasDetail: boolean;
};

const BASE = "https://www.homeexchange.com";

// Bit flags from HomeExchange's front-end bundle (home.feature.<group>).
const FEATURES: Record<string, Record<number, string>> = {
  multimedia: { 1: "tv", 2: "computer", 4: "internet", 8: "wifi", 16: "home_cinema", 64: "satellite_cable", 128: "phone", 512: "game_console", 1024: "smart_tv" },
  various: { 1: "air_conditioning", 2: "elevator", 4: "parking", 8: "piano", 16: "jacuzzi", 32: "sauna", 64: "fireplace", 128: "gym", 256: "pool_table" },
  practical: { 1: "disabled_access", 2: "baby_gear", 4: "dishwasher", 8: "dryer", 16: "washing_machine", 32: "microwave", 128: "freezer", 256: "oven", 512: "fridge", 1024: "bathtub", 2048: "heating", 4096: "ev_charger" },
  outdoor: { 1: "garden", 2: "pool", 4: "bbq", 16: "tennis_court", 32: "ping_pong", 64: "balcony_terrace" },
  transportation: { 1: "car", 2: "bicycle", 4: "scooter", 8: "motorcycle", 16: "motorboat", 32: "sailboat", 64: "electric_car" },
  personal: { 1: "doorman", 2: "cleaning_person", 4: "babysitter", 8: "cook", 16: "guide" },
  kids: { 1: "kids_toys", 2: "playground", 4: "baby_gear", 8: "secured_pool", 16: "baby_bed" },
  eco: { 1: "renewable_energy", 2: "low_consumption_appliances", 4: "waste_sorting", 8: "vegetable_garden", 16: "public_transit", 32: "solar_panels" },
  remote: { 1: "high_speed_internet", 2: "workspace" },
};
const RULES: Record<number, string> = { 1: "smokers_welcome", 2: "pets_welcome", 4: "children_welcome" };
const FAVORS: Record<number, string> = { 1: "dog", 2: "cat", 4: "plants" };
const HOME_TYPES: Record<number, string> = { 1: "house", 2: "apartment", 3: "other" };
const RESIDENCE: Record<number, string> = { 1: "primary", 2: "secondary", 3: "primary", 4: "secondary" };
const COUNTRY_CODES: Record<string, string> = { "United States": "US", "Etats-Unis": "US", USA: "US" };

const bits = (value: number | undefined, map: Record<number, string>) =>
  Object.entries(map)
    .filter(([bit]) => value != null && (value & Number(bit)) !== 0)
    .map(([, name]) => name);

function amenityList(features: Record<string, number> | null) {
  if (!features) return [];
  const out = new Set<string>();
  for (const [group, map] of Object.entries(FEATURES)) for (const a of bits(features[group], map)) out.add(a);
  return [...out];
}

export const homeexchange: SourceAdapter = {
  sourceId: "homeexchange",

  normalize(input) {
    const h = input as HeItem;
    if (!h?.id) return null;

    const city = h.admins?.admin3 ?? h.admins?.admin2 ?? null;
    const rules = bits(h.features?.rule, RULES);
    const bedrooms = h.size?.bedroom_nb ?? null;

    const listing: NormalizedListing = {
      externalId: String(h.id),
      externalUrl: `${BASE}/holiday-home/${h.id}`,
      type: h.isPrivateRoom ? "private_room" : "entire_place",
      title: h.title?.trim() || `${h.isPrivateRoom ? "Private room" : "Home"} in ${city ?? "California"}`,
      description: h.description?.trim() || null,
      guestExpectations: null,
      houseRules: rules.length ? rules.join(", ").replace(/_/g, " ") : null,
      neighborhood: null,
      city,
      subregion: h.admins?.admin2 ?? null,
      region: h.admins?.admin1 ?? null,
      countryCode: (h.admins?.country && COUNTRY_CODES[h.admins.country]) ?? null,
      // Rounded to 2 decimals by the scraper (~1km).
      lat: h.lat,
      lng: h.lng,
      locationPrecision: h.lat != null ? "approximate" : null,
      maxGuests: h.capacity ?? null,
      minNights: h.minNights || null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: amenityList(h.features),
      languages: [],
      rating: h.globalRating ?? null,
      attributes: {
        exchangeType: "home_swap",
        guestPoints: h.guestPointsPerNight ?? null,
        guestPointsUnit: "per_night",
        prefersReciprocal: h.prefersReciprocal ?? null,
        homeType: h.homeType != null ? (HOME_TYPES[h.homeType] ?? null) : null,
        residence: h.residenceType != null ? (RESIDENCE[h.residenceType] ?? null) : null,
        bedrooms,
        bathrooms: h.size?.bathroom_nb ?? null,
        sizeSqft: h.size?.size_unit === "sqft" ? (h.size.localized_size ?? null) : null,
        sizeM2: h.size?.size ?? null,
        petsWelcome: rules.includes("pets_welcome"),
        childrenWelcome: rules.includes("children_welcome"),
        careWanted: bits(h.features?.favor, FAVORS),
        aboutNeighborhood: h.aboutNeighborhood?.trim() || null,
        otherInfo: h.otherInfo?.trim() || null,
        exchangeCount: h.exchangeCount ?? null,
        verified: h.isVerified,
        collection: h.isCollection ?? null,
        detailAvailable: h.hasDetail,
      },
      host: h.user
        ? {
            externalId: String(h.user.id),
            displayName: h.user.firstName ?? null,
            avatarUrl: h.user.avatarUrl ?? null,
            referenceCount: h.user.exchanges ?? null,
            rating: h.user.rating ?? null,
          }
        : undefined,
      photos: h.images.map((url) => ({ sourceUrl: url })),
      // Calendar is login-only.
      availability: [],
      raw: h,
    };
    return listing;
  },
};

export default homeexchange;
