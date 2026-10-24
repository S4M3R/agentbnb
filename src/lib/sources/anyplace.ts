import type { NormalizedListing, SourceAdapter } from "./types";

type Photo = { url: string; width?: number | null; height?: number | null; caption?: string | null };

/** One listing's propertyInfo from an Anyplace listing page (see scripts/scrapers/anyplace.node.ts). */
type AnyplaceRaw = {
  url: string;
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  addtionalRules?: string | null;
  propertyType?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  minimumStay?: number | null;
  maximumStay?: number | null;
  petsAllowed?: boolean | null;
  floor?: string | null;
  checkinTime?: string | null;
  checkoutTime?: string | null;
  managedByAnyplace?: boolean;
  anyplaceSelect?: boolean;
  city?: { name?: string | null; slug?: string | null } | null;
  country?: { isoCode?: string | null } | null;
  currency?: { code?: string | null } | null;
  neighborhood?: { name?: string | null } | null;
  building?: { name?: string | null; amenities?: { name: string }[] } | null;
  hotelAmenities?: { amenity: { amenityType: string; name: string } }[];
  coverPhoto?: Photo | null;
  photos?: Photo[];
  metadata?: { googleRatingAverage?: number | null; googleReviews?: number | null } | null;
  cancellationPolicy?: { name?: string | null } | null;
  rooms?: {
    name: string;
    available: boolean;
    nextAvailableDate: string | null;
    basePrice?: { baseMonthlyRate?: number | null; baseNightlyRate?: number | null; currency?: string | null } | null;
    basePriceWithCharges?: number | null;
    discountsInfo?: { discount: string; title: string }[];
    numberOfBedrooms?: number | null;
    numberOfBathrooms?: number | null;
    numberOfBeds?: number | null;
    bedsDescription?: string | null;
    occupancyLimit?: number | null;
    photos?: Photo[];
  }[];
};

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const round3 = (n?: number | null) => (n == null ? null : Math.round(n * 1000) / 1000);
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export const anyplace: SourceAdapter = {
  sourceId: "anyplace",

  normalize(input) {
    const p = input as AnyplaceRaw;
    if (!p?.id || !p.name) return null;
    const room = p.rooms?.[0];
    const monthly = room?.basePriceWithCharges ?? room?.basePrice?.baseMonthlyRate ?? null;
    const isRoom = /room|coliving|shared/i.test(p.propertyType ?? "") && !/apartment/i.test(p.propertyType ?? "");

    const amenities = (p.hotelAmenities ?? [])
      .filter((a) => a.amenity.amenityType === "facility")
      .map((a) => a.amenity.name);
    const rules = (p.hotelAmenities ?? []).filter((a) => a.amenity.amenityType === "rule").map((a) => a.amenity.name);
    const buildingAmenities = (p.building?.amenities ?? []).map((a) => titleCase(a.name));

    const start = room?.nextAvailableDate ?? (room?.available ? new Date().toISOString().slice(0, 10) : null);
    const photos = [...(p.photos ?? []), ...(room?.photos ?? [])];
    if (!photos.length && p.coverPhoto) photos.push(p.coverPhoto);

    const listing: NormalizedListing = {
      externalId: p.id,
      externalUrl: p.url,
      type: isRoom ? "private_room" : "entire_place",
      title: p.name,
      description: p.description ?? null,
      guestExpectations: null,
      houseRules: [rules.join(". "), p.addtionalRules].filter(Boolean).join("\n\n") || null,
      neighborhood: p.neighborhood?.name ?? null,
      city: p.city?.name ?? null,
      subregion: null,
      region: "CA",
      countryCode: p.country?.isoCode ?? "US",
      // Managed apartment building; rounded, street address not kept.
      lat: round3(p.latitude),
      lng: round3(p.longitude),
      locationPrecision: "approximate",
      maxGuests: room?.occupancyLimit ?? null,
      minNights: p.minimumStay ?? null,
      maxNights: p.maximumStay ?? null,
      priceModel: "paid",
      priceAmountCents: monthly != null ? Math.round(monthly * 100) : null,
      currency: room?.basePrice?.currency ?? p.currency?.code ?? "USD",
      pricePeriod: "month",
      amenities: [...new Set([...amenities, ...buildingAmenities])],
      languages: [],
      rating: p.metadata?.googleRatingAverage ?? null,
      attributes: {
        priceIsFrom: true, // longer stays get discounts
        priceIncludesFees: true,
        baseMonthlyRate: room?.basePrice?.baseMonthlyRate ?? null,
        baseNightlyRate: room?.basePrice?.baseNightlyRate ?? null,
        discounts: (room?.discountsInfo ?? []).map((d) => `${d.discount}: ${d.title}`),
        furnished: true,
        utilitiesIncluded: /all utilities|utilities included/i.test(p.description ?? "") || null,
        bedrooms: room?.numberOfBedrooms ?? null,
        bathrooms: room?.numberOfBathrooms ?? null,
        beds: room?.bedsDescription ?? null,
        unitType: room?.name ?? null,
        building: p.building?.name ?? null,
        buildingAmenities,
        floor: p.floor ?? null,
        minStayNights: p.minimumStay ?? null,
        petsAllowed: p.petsAllowed ?? null,
        checkIn: p.checkinTime ?? null,
        checkOut: p.checkoutTime ?? null,
        managedByAnyplace: p.managedByAnyplace ?? null,
        googleReviewCount: p.metadata?.googleReviews ?? null,
        cancellationPolicy: p.cancellationPolicy?.name ?? null,
      },
      photos: photos.map((ph) => ({
        sourceUrl: ph.url,
        width: ph.width ?? null,
        height: ph.height ?? null,
        caption: ph.caption || null,
      })),
      availability: start ? [{ startDate: start, endDate: addMonths(start, 12), attributes: { openEnded: true } }] : [],
      raw: { ...p, latitude: round3(p.latitude), longitude: round3(p.longitude) },
    };
    return listing;
  },
};

export default anyplace;
