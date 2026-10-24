import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/padsplit.node.ts writes per property (the page's property JSON, scrubbed). */
type Picture = { location?: string; url?: string; imageWidth?: number; imageHeight?: number; description?: string | null };
type Room = {
  id: number;
  name?: string;
  status: number;
  detailedStatus?: string;
  roomNumber?: number;
  totalWeeklyRate?: number | null;
  basePrice?: number | null;
  priceBeforeDrop?: number | null;
  moveInFee?: number | null;
  startMoveInDate?: string | null;
  pricesForCommitment?: Record<string, number> | null;
  promoLabel?: string | null;
  activePromo?: unknown;
  sqFt?: number | null;
  description?: string | null;
  amenities?: Record<string, unknown>;
  pictures?: Picture[];
};
type PadSplitRaw = {
  id: number;
  url: string;
  scrapedAt?: string;
  listingStatus: string;
  name: string;
  description?: string | null;
  lat: number;
  lng: number;
  propertyType?: string | null;
  bedrooms?: string | null;
  bathrooms?: string | null;
  sqFt?: number | null;
  transitName?: string | null;
  transitDist?: number | null;
  amenities?: Record<string, unknown>;
  propertyRules?: Record<string, unknown>;
  address?: { city?: string; neighborhood?: string; state?: string };
  rooms?: Room[];
  orderedPictures?: Picture[];
  primaryOperator?: { id: number; firstName?: string | null; picture?: string | null; dateJoined?: string | null } | null;
  ownerResiding?: boolean;
  totalRoomsCount?: number | null;
  reviewsCount?: number | null;
  propertyRatingAvg?: number | null;
  propertyRatingCount?: number | null;
  isGoldKeyHost?: boolean;
  noMoveInFee?: boolean;
  totalParkingSpots?: number | null;
  offPremisesParking?: boolean;
  hasProfessionalCleaningService?: boolean;
  weekdayMoveInFrom?: string;
  weekdayMoveInTo?: string;
};

const COUNTY: Record<string, string> = {
  "San Francisco": "San Francisco County",
  Oakland: "Alameda County",
  Berkeley: "Alameda County",
  Hayward: "Alameda County",
  Fremont: "Alameda County",
  "San Leandro": "Alameda County",
  Vallejo: "Solano County",
  Fairfield: "Solano County",
  Benicia: "Solano County",
  Crockett: "Contra Costa County",
  Concord: "Contra Costa County",
  Richmond: "Contra Costa County",
  Antioch: "Contra Costa County",
  "San Jose": "Santa Clara County",
  "Daly City": "San Mateo County",
  "San Mateo": "San Mateo County",
  "Redwood City": "San Mateo County",
};

// Property-level amenity flags worth surfacing (PadSplit keys → labels).
const AMENITY_LABELS: Record<string, string> = {
  wifi: "WiFi",
  dishwasher: "Dishwasher",
  backyard: "Backyard",
  patioDeck: "Patio / deck",
  balcony: "Balcony",
  television: "TV",
  cookware: "Cookware",
  diningTable: "Dining table",
  comfyChairs: "Living room seating",
  airConditioning: "Air conditioning",
  heating: "Heating",
  microwave: "Microwave",
  oven: "Oven",
  stove: "Stove",
  toaster: "Toaster",
  foodDisposal: "Garbage disposal",
  pool: "Pool",
  garage: "Garage",
  smartLock: "Smart lock",
  securityCameras: "Security cameras",
  firstAidKit: "First aid kit",
  fireExtinguisher: "Fire extinguisher",
  carbonMonoxideDetector: "Carbon monoxide detector",
};

const redact = (s: string | null | undefined) =>
  s
    ?.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, "[phone removed]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email removed]")
    .trim() || null;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const round = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

function amenities(r: PadSplitRaw) {
  const a = r.amenities ?? {};
  const out = Object.entries(AMENITY_LABELS)
    .filter(([k]) => a[k] === true)
    .map(([, label]) => label);
  if (a.washer === "in-home") out.push("Washer (in home)");
  else if (a.washer) out.push(`Washer (${a.washer})`);
  if (a.wifiSpeed === "high-speed") out.push("High-speed WiFi");
  out.push("Utilities included", "Furnished");
  if (r.totalParkingSpots) out.push("Parking");
  return [...new Set(out)];
}

function houseRules(rules: Record<string, unknown> | undefined) {
  if (!rules) return null;
  const lines: string[] = [];
  if (rules.quietHours === "yes" && rules.quietHourFrom != null && rules.quietHourTo != null) {
    lines.push(`Quiet hours ${rules.quietHourFrom}:00–${rules.quietHourTo}:00`);
  }
  if (typeof rules.otherText === "string" && rules.otherText.trim()) lines.push(rules.otherText.trim());
  if (typeof rules.other === "string" && rules.other.trim()) lines.push(rules.other.trim());
  return redact(lines.join("\n")) ?? null;
}

/** One listing per room that's open to book. */
function normalizeRoom(r: PadSplitRaw, room: Room): NormalizedListing | null {
  const weekly = room.totalWeeklyRate ?? room.basePrice;
  if (!weekly || weekly <= 0) return null;
  const now = r.scrapedAt ? new Date(r.scrapedAt) : new Date();
  const today = iso(now);
  const start = room.startMoveInDate && room.startMoveInDate > today ? room.startMoveInDate : today;
  const end = iso(new Date(Date.parse(start) + 365 * 864e5));

  const ra = room.amenities ?? {};
  const city = r.address?.city ?? null;
  const hood = r.address?.neighborhood || null;
  const bath = ra.bathroomType === "private" ? "private bath" : "shared bath";
  const bed = typeof ra.bedSize === "string" ? `${ra.bedSize.replace(/xl$/i, " XL")} bed` : null;
  const label = room.name?.trim() || (room.roomNumber != null ? `Room ${room.roomNumber}` : "Room");

  const roomAmenities = [
    ra.workspace === true && "Desk / workspace",
    ra.miniFridge === true && "Mini fridge",
    ra.microwave === true && "Microwave in room",
    ra.ceilingFan === true && "Ceiling fan",
    ra.privateAccess === true && "Private entrance",
    ra.climateControl === "central-ac" && "Central AC",
    ra.bathroomType === "private" && "Private bathroom",
  ].filter((x): x is string => typeof x === "string");

  const photos = [...(room.pictures ?? []), ...(r.orderedPictures ?? [])]
    .map((p) => ({ sourceUrl: p.location ?? p.url ?? "", width: p.imageWidth ?? null, height: p.imageHeight ?? null, caption: p.description ?? null }))
    .filter((p, i, all) => p.sourceUrl && all.findIndex((q) => q.sourceUrl === p.sourceUrl) === i)
    .slice(0, 25);

  return {
    externalId: `${r.id}-${room.id}`,
    externalUrl: r.url,
    type: "private_room",
    // Home names are sometimes already "Private Room — North Beach, …".
    title: /\broom\b/i.test(r.name)
      ? `${r.name.trim()} (${label})`
      : `Private room in ${r.name.trim().replace(/[\s,]+$/, "")} (${label})`,
    description: redact(r.description),
    guestExpectations: null,
    houseRules: houseRules(r.propertyRules),
    neighborhood: hood,
    city,
    subregion: city ? (COUNTY[city] ?? null) : null,
    region: "California",
    countryCode: "US",
    lat: round(r.lat),
    lng: round(r.lng),
    locationPrecision: "approximate",
    maxGuests: ra.allowedOccupantsQuantity === "couple" ? 2 : 1,
    minNights: null,
    maxNights: null,
    priceModel: "paid",
    priceAmountCents: Math.round(weekly * 100),
    pricePeriod: "week",
    currency: "USD",
    amenities: [...roomAmenities, ...amenities(r)],
    languages: [],
    rating: r.propertyRatingCount ? (r.propertyRatingAvg ?? null) : null,
    attributes: {
      propertyId: r.id,
      propertyName: r.name,
      propertyType: r.propertyType ?? null,
      listingStatus: r.listingStatus,
      roomId: room.id,
      roomNumber: room.roomNumber ?? null,
      roomSize: ra.roomSize ?? null,
      bedSize: ra.bedSize ?? null,
      bathroom: bath,
      bed,
      floorLevel: ra.floorLevel ?? null,
      windows: ra.windows ?? null,
      bedrooms: r.bedrooms ? Number(r.bedrooms) : null,
      bathrooms: r.bathrooms ? Number(r.bathrooms) : null,
      totalRoomsInHome: r.totalRoomsCount ?? null,
      sqFt: r.sqFt ?? null,
      furnished: true,
      utilitiesIncluded: true,
      weeklyRate: weekly,
      priceBeforeDrop: room.priceBeforeDrop ?? null,
      pricesForCommitment: room.pricesForCommitment ?? null,
      moveInFee: room.moveInFee ?? null,
      noMoveInFee: r.noMoveInFee ?? false,
      deposit: null,
      leaseTerms: "Week-to-week membership; optional 5/12/24-week commitments for a lower rate",
      promoLabel: room.promoLabel ?? null,
      transit: r.transitName ? { name: r.transitName, miles: r.transitDist ?? null } : null,
      parkingSpots: r.totalParkingSpots ?? null,
      ownerResiding: r.ownerResiding ?? null,
      professionalCleaning: r.hasProfessionalCleaningService ?? null,
      goldKeyHost: r.isGoldKeyHost ?? null,
      reviewsCount: r.reviewsCount ?? null,
      propertyRules: r.propertyRules ?? null,
      moveInHours: r.weekdayMoveInFrom ? `${r.weekdayMoveInFrom}–${r.weekdayMoveInTo}` : null,
    },
    host: r.primaryOperator?.id
      ? {
          externalId: String(r.primaryOperator.id),
          displayName: r.primaryOperator.firstName ?? null,
          avatarUrl: r.primaryOperator.picture ?? null,
          memberSince: r.primaryOperator.dateJoined ? new Date(r.primaryOperator.dateJoined) : null,
        }
      : undefined,
    photos,
    availability: [
      {
        externalId: null,
        startDate: start,
        endDate: end,
        attributes: { openEnded: true, availableNow: start === today, earliestMoveIn: room.startMoveInDate ?? null },
      },
    ],
    raw: { property: { ...r, lat: round(r.lat), lng: round(r.lng) }, room },
  };
}

export const padsplit: SourceAdapter = {
  sourceId: "padsplit",

  /** Scrape items are one per listed room: `{ property, room }`. */
  normalize(input) {
    const x = input as { property?: PadSplitRaw; room?: Room };
    if (!x?.property?.id || !x.property.url || !x.room?.id) return null;
    if (x.room.status !== 1 || (x.room.detailedStatus ?? "listed") !== "listed") return null;
    return normalizeRoom(x.property, x.room);
  },
};

export default padsplit;
