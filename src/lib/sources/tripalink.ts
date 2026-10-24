import type { NormalizedListing, SourceAdapter } from "./types";

// One record per bookable room or whole unit, as written by scripts/scrapers/tripalink.node.ts.
type TripalinkItem = {
  scrapedAt: string;
  property: {
    id: string;
    name: string;
    isColiving: boolean | null;
    minPrice: string | null;
    maxPrice: string | null;
    introduce: string | null;
    longitude: string | null;
    latitude: string | null;
    address: string | null;
    sellingHeadline: string | null;
    aiIntroduceKeywords: string[] | null;
    area: string | null;
    city: string | null;
    state: string | null;
    zipoCode: string | null;
    propertyType: string | null;
    marketingTag: string | null;
    url: string;
    photos: { url: string; tag: string | null }[];
    amenities: { name: string; level: string | null }[];
    campaign: { campaignName: string | null; campaignDescription: string | null } | null;
    rentalPolicy: { type: string; values: string[] }[];
  };
  unit: {
    id: string;
    name: string;
    floorPlanBedroomNum: string | null;
    floorPlanBathroomNum: string | null;
    totalArea: string | null;
    sharedBathroom: boolean | null;
    floorPlans: string[];
    amenities: string[];
    minOnePersonPrice: string | null;
  };
  room: {
    id: string;
    name: string;
    price: string | null;
    originalPrice: string | null;
    virtual: boolean | null;
    totalArea: string | null;
    availableStartTime: number | null;
    availableContent: string | null;
    roomConcessionDesc: string | null;
    photos: string[];
    floorPlans: string[];
    vrUrl: string | null;
    videoUrl: string | null;
    amenities: string[];
  };
};

const STATES: Record<string, string> = { CA: "California" };
const num = (s: string | null | undefined) => (s == null || s === "" ? null : Number(s));

/** Calendar date in the property's time zone (Tripalink stores PT midnight as epoch ms). */
const laDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const tripalink: SourceAdapter = {
  sourceId: "tripalink",

  normalize(input) {
    const { property: p, unit: u, room: r, scrapedAt } = input as TripalinkItem;
    const price = num(r?.price);
    if (!p?.id || !r?.id || !price) return null;

    const wholeUnit = r.virtual === true;
    const today = laDate(Date.parse(scrapedAt ?? new Date().toISOString()));
    const available = r.availableStartTime ? laDate(r.availableStartTime) : today;
    const start = available < today ? today : available;
    const policy = Object.fromEntries((p.rentalPolicy ?? []).map((x) => [x.type, x.values]));
    const amenities = [
      ...new Set([...(p.amenities ?? []).map((a) => a.name), ...(u.amenities ?? []), ...(r.amenities ?? [])]),
    ];
    const bedrooms = num(u.floorPlanBedroomNum);
    const bathrooms = num(u.floorPlanBathroomNum);

    const listing: NormalizedListing = {
      externalId: wholeUnit ? `unit-${u.id}` : `room-${r.id}`,
      externalUrl: p.url,
      type: wholeUnit ? "entire_place" : "private_room",
      title: wholeUnit
        ? `${u.name} at ${p.name} (${bedrooms ?? "?"}BR, whole unit)`
        : `${r.name}, ${u.name} at ${p.name}`,
      description: p.introduce?.trim() || p.sellingHeadline || null,
      guestExpectations: null,
      houseRules: policy.Pet?.length ? `Pets: ${policy.Pet.join("; ")}` : null,
      neighborhood: p.area ?? null,
      city: p.city ?? null,
      subregion: null,
      region: (p.state && STATES[p.state]) ?? p.state ?? null,
      countryCode: "US",
      lat: num(p.latitude),
      lng: num(p.longitude),
      locationPrecision: "exact",
      maxGuests: wholeUnit ? bedrooms : 2, // "2 tenant max per room"
      minNights: null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents: Math.round(price * 100),
      currency: "USD",
      pricePeriod: "month",
      amenities,
      languages: [],
      rating: null,
      attributes: {
        operator: "Tripalink",
        coliving: p.isColiving ?? true,
        buildingName: p.name,
        address: p.address,
        zip: p.zipoCode,
        propertyType: p.propertyType,
        headline: p.sellingHeadline,
        keywords: p.aiIntroduceKeywords ?? [],
        unitName: u.name,
        roomName: wholeUnit ? null : r.name,
        roomSqft: num(r.totalArea),
        unitSqft: num(u.totalArea),
        unitBedrooms: bedrooms,
        unitBathrooms: bathrooms,
        sharedBathroom: u.sharedBathroom,
        furnished: amenities.includes("Furnished"),
        utilitiesIncluded: false,
        utilityFees: policy["Utility Fees"] ?? null,
        internetFee: policy["Internet Fee"] ?? null,
        securityDeposit: policy["Security Deposit"] ?? null,
        applicationPolicy: policy.Application ?? null,
        occupancy: policy.Occupancy ?? null,
        parking: policy.Parking ?? null,
        originalPriceUsd: num(r.originalPrice),
        doubleOccupancyPerPersonUsd: num(u.minOnePersonPrice),
        marketingTag: p.marketingTag,
        promotion: p.campaign?.campaignName
          ? `${p.campaign.campaignName}: ${p.campaign.campaignDescription ?? ""}`.trim()
          : null,
        concession: r.roomConcessionDesc,
        availableText: r.availableContent,
        vrUrl: r.vrUrl,
        videoUrl: r.videoUrl,
        floorPlans: [...(r.floorPlans ?? []), ...(u.floorPlans ?? [])],
      },
      photos: [
        ...new Map(
          [
            ...(r.photos ?? []).map((url) => ({ sourceUrl: url, caption: null as string | null })),
            ...(p.photos ?? [])
              .filter((ph) => ph.tag !== "Floor Plan")
              .map((ph) => ({ sourceUrl: ph.url, caption: ph.tag })),
          ].map((ph) => [ph.sourceUrl, ph]),
        ).values(),
      ],
      availability: [
        {
          externalId: wholeUnit ? `unit-${u.id}` : `room-${r.id}`,
          startDate: start,
          endDate: addMonths(start, 12),
          attributes: { openEnded: true, availableText: r.availableContent },
        },
      ],
      raw: input,
    };
    return listing;
  },
};

export default tripalink;
