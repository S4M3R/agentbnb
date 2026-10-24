import type { NormalizedListing, SourceAdapter } from "./types";

/** One home from Landing's public API: search card merged with /api/public/homes/{slug}. */
type LandingRaw = {
  slug: string;
  name?: string | null;
  home_url?: string | null;
  city?: string | null;
  state?: string | null;
  market?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  square_feet?: number | null;
  minimum_nightly_stay?: number | null;
  available_from?: string | null;
  display_price_with_discount?: number | null;
  display_price_without_discount?: number | null;
  is_price_monthly?: boolean;
  is_price_nightly?: boolean;
  price_note?: string | null;
  currency?: string | null;
  eligible_for_flex?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  has_parking?: boolean;
  laundry_type?: string | null;
  pet_policy?: { cats_allowed?: boolean; dogs_allowed?: boolean } | null;
  property?: {
    name?: string | null;
    amenities?: string[];
    member_rating?: { average?: number | null; count?: number | null } | null;
    walk_score?: number | null;
    transit_score?: number | null;
    bike_score?: number | null;
  } | null;
  photos?: { url: string }[];
  flex_options?: { committed_nights: number; label: string }[];
  availability?: {
    earliest_available_date?: string | null;
    bookable_windows?: { start_date: string; end_date: string | null }[];
  } | null;
};

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const landing: SourceAdapter = {
  sourceId: "landing",

  normalize(input) {
    const h = input as LandingRaw;
    if (!h?.slug) return null;

    const nightly = h.is_price_nightly && !h.is_price_monthly;
    const price = h.display_price_with_discount ?? h.display_price_without_discount ?? null;
    const beds = h.bedrooms ?? null;
    const bedLabel = beds === 0 ? "Studio" : beds ? `${beds}BR` : "Apartment";

    // Bookable windows are contiguous blocks; collapse to one range. A null end
    // means open-ended (past Landing's calendar horizon).
    const windows = h.availability?.bookable_windows ?? [];
    const start = windows[0]?.start_date ?? h.availability?.earliest_available_date ?? h.available_from ?? null;
    const lastEnd = windows.length ? windows[windows.length - 1].end_date : null;
    const availability: NormalizedListing["availability"] = start
      ? [
          lastEnd
            ? { startDate: start, endDate: lastEnd }
            : { startDate: start, endDate: addMonths(start, 12), attributes: { openEnded: true } },
        ]
      : [];

    const amenities = [...(h.property?.amenities ?? [])];
    if (h.laundry_type) amenities.push(`Laundry: ${h.laundry_type}`);
    if (h.has_parking) amenities.push("Parking");

    const listing: NormalizedListing = {
      externalId: h.slug,
      externalUrl: (h.home_url ?? `https://www.hellolanding.com/homes/${h.slug}`).split("?")[0],
      type: "entire_place",
      title: `Furnished ${bedLabel} at ${h.property?.name ?? h.name ?? "Landing"}${h.city ? `, ${h.city}` : ""}`,
      description: [
        `Fully furnished ${beds === 0 ? "studio" : `${beds ?? ""}-bedroom`.replace(/^-/, "")} apartment by Landing`,
        h.square_feet ? ` (${h.square_feet} sq ft)` : "",
        ". Flexible monthly stays, no security deposit. ",
        h.price_note ?? "",
      ]
        .join("")
        .trim(),
      guestExpectations: null,
      houseRules: null,
      neighborhood: null,
      city: h.city ?? null,
      subregion: null,
      region: h.state ?? "CA",
      countryCode: "US",
      // Building pin from a professionally managed apartment complex; rounded
      // anyway and the street address is not stored.
      lat: h.latitude != null ? round(h.latitude, 3) : null,
      lng: h.longitude != null ? round(h.longitude, 3) : null,
      locationPrecision: "approximate",
      maxGuests: null,
      minNights: h.minimum_nightly_stay ?? null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents: price != null ? Math.round(price * 100) : null,
      currency: h.currency ?? "USD",
      pricePeriod: nightly ? "night" : "month",
      amenities,
      languages: [],
      rating: h.property?.member_rating?.average ?? null,
      attributes: {
        priceIsFrom: true, // varies with dates and stay length
        priceIncludesFees: true,
        furnished: true,
        bedrooms: beds,
        bathrooms: h.bathrooms ?? null,
        squareFeet: h.square_feet ?? null,
        minStayNights: h.minimum_nightly_stay ?? null,
        building: h.property?.name ?? null,
        petsCats: h.pet_policy?.cats_allowed ?? null,
        petsDogs: h.pet_policy?.dogs_allowed ?? null,
        flexStays: h.eligible_for_flex ?? null,
        flexOptions: h.flex_options?.map((f) => f.label) ?? [],
        ratingCount: h.property?.member_rating?.count ?? null,
        walkScore: h.property?.walk_score ?? null,
        transitScore: h.property?.transit_score ?? null,
        bikeScore: h.property?.bike_score ?? null,
        noSecurityDeposit: true,
      },
      photos: (h.photos ?? []).map((p) => ({ sourceUrl: p.url })),
      availability,
      raw: { ...h, address: undefined, property: { ...h.property, address: undefined } },
    };
    return listing;
  },
};

export default landing;
