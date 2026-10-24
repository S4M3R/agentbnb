import type { NormalizedListing, SourceAdapter } from "./types";

// Shape written by scripts/scrapers/roomi.node.ts (already stripped of personal data).
type RoomiItem = {
  id: string;
  slug: string;
  status?: string | null;
  archivedAt?: string | null;
  snoozedAt?: string | null;
  pricePerMonth?: number | null;
  securityDeposit?: number | null;
  roomType?: string | null; // private | shared | entire
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  availabilityDate?: string | null;
  moveOutDate?: string | null;
  leaseDuration?: string | null;
  roommateCount?: number | null;
  roommateAgeRange?: [number | null, number | null];
  situation?: string | null;
  description?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  locationSlug?: string | null;
  postalCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  photos?: string[];
  amenityIds?: string[];
  amenities?: string[];
  publishedAt?: string | null;
  updatedAt?: string | null;
  host?: { id: string; firstName?: string | null; avatar?: string | null; memberSince?: string | null; badges?: string[] } | null;
};

const BASE = "https://roomiapp.com";

/** SF neighborhoods Roomi files as their own "location" (display city would be the neighborhood). */
const SF_NEIGHBORHOODS = new Set(["Chinatown", "Mission District", "SoMa", "Nob Hill", "Outer Sunset", "Inner Sunset"]);

/**
 * Template ads Roomi is flooded with: a whole 1BR in the Bay Area for $800-1,000 with
 * "email me for photos/viewing". They're the classic rental-scam pattern, so they're skipped.
 */
function likelyScam(l: RoomiItem) {
  const text = l.description ?? "";
  const offPlatform = /\[email removed\]|\bemail\b[^.]*\b(for|to)\b[^.]*(details|photos|viewing|information)|contact (me|us) (at|via)/i.test(text);
  const tooCheap = l.roomType === "entire" && (l.pricePerMonth ?? 0) < 1500;
  return tooCheap || (offPlatform && text.length < 300);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export const roomi: SourceAdapter = {
  sourceId: "roomi",

  normalize(input) {
    const l = input as RoomiItem;
    if (!l?.id || l.status !== "active" || l.archivedAt || l.snoozedAt) return null;
    if (likelyScam(l)) return null;

    const rate = l.pricePerMonth ?? null;
    const priceAmountCents = rate != null && rate >= 100 ? Math.round(rate * 100) : null;
    const type =
      l.roomType === "shared" ? "shared_room" : l.roomType === "entire" ? "entire_place" : "private_room";

    const today = ymd(new Date());
    const moveIn = l.availabilityDate?.slice(0, 10) ?? null;
    const start = moveIn && moveIn > today ? moveIn : today;
    const moveOut = l.moveOutDate?.slice(0, 10) ?? null;
    const end =
      moveOut && moveOut > start
        ? moveOut
        : (() => {
            const d = new Date(`${start}T00:00:00Z`);
            d.setUTCMonth(d.getUTCMonth() + 12);
            return ymd(d);
          })();

    const inSfNeighborhood = !!l.city && SF_NEIGHBORHOODS.has(l.city);
    const city = inSfNeighborhood ? "San Francisco" : (l.city ?? null);
    const neighborhood = inSfNeighborhood ? l.city! : (l.neighborhood ?? null);
    const what = type === "entire_place" ? (l.propertyType === "house" ? "House" : "Apartment") : type === "shared_room" ? "Shared room" : "Private room";

    const listing: NormalizedListing = {
      externalId: l.id,
      externalUrl: `${BASE}/room-rental/${l.slug}`,
      type,
      title: `${what} for rent in ${neighborhood ? `${neighborhood}, ` : ""}${city ?? "the Bay Area"}`,
      description: l.description?.trim() || null,
      guestExpectations: null,
      houseRules: null,
      neighborhood,
      city,
      subregion: null,
      region: "California",
      countryCode: "US",
      lat: l.lat ?? null,
      lng: l.lng ?? null,
      locationPrecision: "approximate",
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents,
      currency: priceAmountCents != null ? "USD" : null,
      pricePeriod: priceAmountCents != null ? "month" : null,
      amenities: (l.amenities ?? []).map(slug),
      languages: [],
      rating: null,
      attributes: {
        listedMonthlyRate: rate,
        securityDeposit: l.securityDeposit ?? null,
        propertyType: l.propertyType ?? null,
        bedrooms: l.bedrooms ?? null,
        bathrooms: l.bathrooms ?? null,
        leaseTerm: l.leaseDuration ?? null,
        furnished: l.amenityIds?.includes("amenity-furnished") ? true : l.amenityIds?.includes("amenity-unfurnished") ? false : null,
        utilitiesIncluded: l.amenityIds?.includes("amenity-utilities") ? true : null,
        hostLivesThere: l.situation ? /^I live here/i.test(l.situation) : null,
        situation: l.situation ?? null,
        roommateCount: l.roommateCount ?? null,
        roommatePreference: { ageRange: l.roommateAgeRange ?? null },
        moveInDate: moveIn,
        postedAt: l.publishedAt ?? null,
        postalCode: l.postalCode ?? null,
        hostBadges: l.host?.badges ?? [],
      },
      host: l.host
        ? {
            externalId: l.host.id,
            displayName: l.host.firstName ?? null,
            profileUrl: null,
            avatarUrl: l.host.avatar ?? null,
            memberSince: l.host.memberSince ? new Date(l.host.memberSince) : null,
          }
        : undefined,
      photos: (l.photos ?? []).map((sourceUrl) => ({ sourceUrl })),
      availability: [
        {
          externalId: null,
          startDate: start,
          endDate: end,
          attributes: moveOut ? { moveInDate: moveIn } : { openEnded: true, moveInDate: moveIn },
        },
      ],
      raw: l,
    };
    return listing;
  },
};

export default roomi;
