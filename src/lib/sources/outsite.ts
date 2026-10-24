import type { NormalizedListing, SourceAdapter } from "./types";

// One record per room type at an Outsite house, as written by scripts/scrapers/outsite.node.ts.
type OutsiteItem = {
  scrapedAt: string;
  house: {
    id: string;
    name: string;
    slug: string;
    url: string;
    minimumLOS: number | null;
    rating: number | null;
    latitude: number | null;
    longitude: number | null;
    roomTypeSummary: string | null;
    currency: string | null;
    isMembersOnly: boolean | null;
    status: string | null;
    reviewCount: number | null;
    cmsName: string | null;
    propertyType: string | null;
    propertyPolicy?: { propertyCheckInTime?: string; propertyCheckOutTime?: string } | null;
    ld: {
      name: string;
      description: string | null;
      image: string[] | null;
      address: { addressLocality?: string; addressRegion?: string } | null;
      amenities: string[];
    } | null;
  };
  roomType: {
    id: string;
    name: string;
    description?: string | null;
    roomType: string; // PRIVATE | PRIVATE_PRIVATE_BATHROOM | SHARED...
    bedType: string | null;
    photos: string[];
    roomSize: number | null;
    availableOnline: boolean | null;
    rates: { nightly: number | null; weekly: number | null; monthly: number | null; extended: number | null } | null;
    maxGuests: number | null;
    roomCount: number | null;
  };
};

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const outsite: SourceAdapter = {
  sourceId: "outsite",

  normalize(input) {
    const { house: h, roomType: rt, scrapedAt } = input as OutsiteItem;
    if (!h?.slug || !rt?.id || h.status !== "ACTIVE") return null;
    const rates = rt.rates ?? { nightly: null, weekly: null, monthly: null, extended: null };
    const monthly = rates.monthly ?? null;
    const nightly = rates.nightly ?? null;
    if (!monthly && !nightly) return null;

    const houseName = h.cmsName ?? h.name.replace(" / ", " - ");
    const neighborhood = houseName.split(" - ").at(-1) ?? null;
    const today = new Date(scrapedAt ?? Date.now()).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const shared = /SHARED|DORM/.test(rt.roomType) && !rt.roomType.startsWith("PRIVATE");

    const listing: NormalizedListing = {
      externalId: `${h.id}:${rt.id}`,
      externalUrl: h.url,
      type: shared ? "shared_room" : "private_room",
      title: `${rt.name} at Outsite ${houseName}`,
      description: [rt.description, h.ld?.description].filter(Boolean).join("\n\n") || null,
      guestExpectations: null,
      houseRules: h.isMembersOnly ? "Outsite Members only: membership required to book." : null,
      neighborhood,
      city: h.ld?.address?.addressLocality ?? "San Francisco",
      subregion: null,
      region: h.ld?.address?.addressRegion ?? "California",
      countryCode: "US",
      // Outsite publishes a house pin but says the exact address is shared after booking.
      lat: h.latitude,
      lng: h.longitude,
      locationPrecision: "approximate",
      maxGuests: rt.maxGuests ?? null,
      minNights: h.minimumLOS ?? null,
      maxNights: null,
      priceModel: "paid",
      // Monthly rate is the coliving-relevant one; nightly/weekly are kept in attributes.
      priceAmountCents: Math.round((monthly ?? nightly ?? 0) * 100),
      currency: h.currency ?? "USD",
      pricePeriod: monthly ? "month" : "night",
      amenities: h.ld?.amenities ?? [],
      languages: [],
      rating: h.rating ?? null,
      attributes: {
        operator: "Outsite",
        coliving: true,
        buildingName: `Outsite ${houseName}`,
        roomType: rt.roomType,
        privateBathroom: rt.roomType === "PRIVATE_PRIVATE_BATHROOM",
        bedType: rt.bedType,
        roomCount: rt.roomCount,
        houseRoomSummary: h.roomTypeSummary,
        rates: { nightly, weekly: rates.weekly, monthly, extended: rates.extended },
        minTermNights: h.minimumLOS,
        membersOnly: h.isMembersOnly ?? false,
        furnished: true,
        utilitiesIncluded: true,
        checkIn: h.propertyPolicy?.propertyCheckInTime ?? null,
        checkOut: h.propertyPolicy?.propertyCheckOutTime ?? null,
        reviewCount: h.reviewCount,
        bookableOnline: rt.availableOnline ?? null,
      },
      photos: [...new Set([...(rt.photos ?? []), ...(h.ld?.image ?? [])])].map((u) => ({ sourceUrl: u })),
      // Outsite exposes no public calendar (the availability API is under /api/, disallowed).
      availability: [
        {
          externalId: `${h.id}:${rt.id}`,
          startDate: today,
          endDate: addMonths(today, 12),
          attributes: { openEnded: true, calendarUnknown: true },
        },
      ],
      raw: input,
    };
    return listing;
  },
};

export default outsite;
