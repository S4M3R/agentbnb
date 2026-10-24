import type { NormalizedListing, SourceAdapter } from "./types";

// One record per available bedroom, as written by scripts/scrapers/bungalow.node.ts.
type BungalowRoom = {
  slug: string;
  url: string;
  scrapedAt: string;
  home: {
    name: string;
    lat: number | null;
    lng: number | null;
    city: string | null;
    amenities: string[];
    numberOfRooms: number | null;
  };
  title: string;
  description: string | null;
  lowPrice: number | null;
  highPrice: number | null;
  photos: string[];
  homeType: string | null;
  sqft: number | null;
  pets: string | null;
  beds: number | null;
  baths: number | null;
  parking: string | null;
  esa: string[];
  tour3d: boolean;
  fromRoommates: string | null;
  feesNote: string | null;
  serviceFee: number | null;
  room: {
    name: string;
    availableText: string | null;
    priceText: string | null;
    monthlyRent: number | null;
    leaseText: string | null;
    sqft: number | null;
  };
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return ymd(d);
}

/** Bungalow shows availability relative to now ("today", "in 13 days", "in 3 months"). */
export function relativeDate(textValue: string | null, from: Date): { date: string; exact: boolean } {
  const t = (textValue ?? "").toLowerCase().trim();
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (!t || t === "today" || t === "now" || t === "a few seconds ago") return { date: ymd(d), exact: true };
  if (t === "tomorrow") {
    d.setUTCDate(d.getUTCDate() + 1);
    return { date: ymd(d), exact: true };
  }
  const m = t.match(/^in (a|an|\d+) (day|week|month|year)s?$/);
  if (m) {
    const n = m[1] === "a" || m[1] === "an" ? 1 : Number(m[1]);
    if (m[2] === "day") d.setUTCDate(d.getUTCDate() + n);
    if (m[2] === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
    if (m[2] === "month") d.setUTCMonth(d.getUTCMonth() + n);
    if (m[2] === "year") d.setUTCFullYear(d.getUTCFullYear() + n);
    return { date: ymd(d), exact: m[2] === "day" };
  }
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) return { date: ymd(new Date(parsed)), exact: true };
  // Past/unknown phrasing ("2 days ago"): treat as available now.
  return { date: ymd(d), exact: false };
}

export const bungalow: SourceAdapter = {
  sourceId: "bungalow",

  normalize(input) {
    const r = input as BungalowRoom;
    if (!r?.slug || !r.room?.name || !r.room.monthlyRent) return null;

    const scraped = new Date(r.scrapedAt ?? Date.now());
    const start = relativeDate(r.room.availableText, scraped);
    const leaseMonths = Number(r.room.leaseText?.match(/(\d+)\s*month/)?.[1]) || null;
    const roomKey = r.room.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const city = r.home.city && r.home.city !== "Bay Area" ? r.home.city : null;

    const listing: NormalizedListing = {
      externalId: `${r.slug}#${roomKey}`,
      externalUrl: r.url,
      type: "private_room",
      title: `${r.room.name} in ${r.title || r.home.name}`.trim(),
      description: r.description?.trim() || null,
      guestExpectations: null,
      houseRules: [r.pets, ...r.esa].filter(Boolean).join(". ") || null,
      neighborhood: null,
      city,
      subregion: null,
      region: "California",
      countryCode: "US",
      // Bungalow's JSON-LD rounds coordinates to 3 decimals and hides the address.
      lat: r.home.lat,
      lng: r.home.lng,
      locationPrecision: "approximate",
      maxGuests: 1,
      // The listed lease is the default; the page offers other terms ("Adjust lease").
      minNights: null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents: Math.round(r.room.monthlyRent * 100),
      currency: "USD",
      pricePeriod: "month",
      amenities: r.home.amenities ?? [],
      languages: [],
      rating: null,
      attributes: {
        operator: "Bungalow",
        coliving: true,
        buildingName: r.title || r.home.name,
        roomName: r.room.name,
        roomSqft: r.room.sqft,
        homeType: r.homeType,
        homeSqft: r.sqft,
        bedrooms: r.beds,
        bathrooms: r.baths,
        totalRooms: r.home.numberOfRooms,
        parking: r.parking,
        pets: r.pets,
        esa: r.esa,
        defaultLeaseMonths: leaseMonths,
        leaseAdjustable: true,
        leaseText: r.room.leaseText,
        furnished: "common areas only",
        utilitiesIncluded: false,
        utilitiesNote: r.feesNote,
        monthlyServiceFeeUsd: r.serviceFee,
        priceText: r.room.priceText,
        homePriceRangeUsd: [r.lowPrice, r.highPrice],
        availableText: r.room.availableText,
        houseNote: r.fromRoommates,
        has3dTour: r.tour3d,
      },
      photos: (r.photos ?? []).map((u) => ({ sourceUrl: u })),
      availability: [
        {
          externalId: `${r.slug}#${roomKey}`,
          startDate: start.date,
          endDate: addMonths(start.date, 12),
          attributes: {
            openEnded: true,
            startApproximate: !start.exact,
            availableText: r.room.availableText,
            defaultLeaseMonths: leaseMonths,
          },
        },
      ],
      raw: r,
    };
    return listing;
  },
};

export default bungalow;
