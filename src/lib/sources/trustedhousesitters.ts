import type { NormalizedListing, SourceAdapter } from "./types";

// Shapes of the parts of /api/v3/search/listings/:id/ we use.
type ThsPhoto = { id: string; publicId: string; width?: number; height?: number; description?: string };
type ThsLocation = {
  name: string;
  slug: string;
  admin1Name?: string;
  admin1Slug?: string;
  admin2Name?: string;
  countryCode?: string;
  countrySlug?: string;
  coordinates?: { lat: number; lon: number };
};
type ThsAssignment = {
  id: string;
  startDate: string;
  endDate: string;
  isConfirmed?: boolean;
  isReviewing?: boolean;
  numberOfApplicants?: number;
  profile?: unknown;
};
type ThsListing = {
  id: string;
  title: string;
  introduction?: string;
  features?: string;
  responsibilities?: string;
  location: ThsLocation;
  user?: {
    id: string;
    firstName?: string;
    joinedDate?: string;
    profilePhoto?: ThsPhoto;
  };
  photos?: ThsPhoto[];
  pets?: { name?: string; yearOfBirth?: number; animal?: { name: string } }[];
  animals?: { name: string; count: number }[];
  assignments?: ThsAssignment[];
  amenities?: Record<string, unknown>;
  homeType?: string;
  localAttractions?: string[];
  familyFriendly?: boolean;
  disabledAccess?: boolean;
  isAccessibleByPublicTransport?: boolean;
  minutesPetCanBeLeftAlone?: number;
  petsWelcome?: boolean;
  guestsWelcome?: boolean;
  feedbackAverageScore?: number | null;
  published?: string;
};

const BASE = "https://www.trustedhousesitters.com";

export function thsPhotoUrl(publicId: string) {
  const id = /\.[a-z0-9]{3,4}$/i.test(publicId) ? publicId : `${publicId}.jpg`;
  return `https://res.cloudinary.com/trustedhousesitters/image/upload/${id}`;
}

function amenityList(amenities: Record<string, unknown> = {}) {
  const out: string[] = [];
  for (const [key, value] of Object.entries(amenities)) {
    if (value === true && key.startsWith("has")) {
      out.push(key.slice(3).replace(/^./, (c) => c.toLowerCase()));
    } else if (typeof value === "string") {
      out.push(`${key}:${value}`);
    } else if (Array.isArray(value)) {
      for (const v of value) out.push(`${key}:${v}`);
    }
  }
  return out;
}

export const trustedHousesitters: SourceAdapter = {
  sourceId: "trustedhousesitters",

  normalize(input) {
    const l = input as ThsListing;
    if (!l?.id || !l.title || !l.location) return null;

    const loc = l.location;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = (l.assignments ?? []).filter((a) => a.endDate >= today);

    const listing: NormalizedListing = {
      externalId: String(l.id),
      externalUrl: `${BASE}/house-and-pet-sitting-assignments/${loc.countrySlug}/${loc.admin1Slug}/${loc.slug}/l/${l.id}/`,
      type: "house_sit",
      title: l.title.trim(),
      description: l.features?.trim() || null,
      guestExpectations: l.responsibilities?.trim() || null,
      houseRules: null,
      neighborhood: null,
      city: loc.name,
      subregion: loc.admin2Name ?? null,
      region: loc.admin1Name ?? null,
      countryCode: loc.countryCode?.toUpperCase() ?? null,
      // TrustedHousesitters only exposes the city centroid publicly.
      lat: loc.coordinates?.lat ?? null,
      lng: loc.coordinates?.lon ?? null,
      locationPrecision: "city",
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: amenityList(l.amenities),
      languages: [],
      rating: l.feedbackAverageScore ?? null,
      attributes: {
        hostIntroduction: l.introduction ?? null,
        homeType: l.homeType ?? null,
        pets: (l.pets ?? []).map((p) => ({ name: p.name, animal: p.animal?.name, yearOfBirth: p.yearOfBirth })),
        animals: l.animals ?? [],
        localAttractions: l.localAttractions ?? [],
        familyFriendly: l.familyFriendly ?? null,
        disabledAccess: l.disabledAccess ?? null,
        publicTransport: l.isAccessibleByPublicTransport ?? null,
        minutesPetCanBeLeftAlone: l.minutesPetCanBeLeftAlone ?? null,
        petsWelcome: l.petsWelcome ?? null,
        guestsWelcome: l.guestsWelcome ?? null,
        publishedAt: l.published ?? null,
      },
      host: l.user
        ? {
            externalId: String(l.user.id),
            displayName: l.user.firstName ?? null,
            avatarUrl: l.user.profilePhoto ? thsPhotoUrl(l.user.profilePhoto.publicId) : null,
            memberSince: l.user.joinedDate ? new Date(`${l.user.joinedDate}Z`) : null,
          }
        : undefined,
      photos: (l.photos ?? []).map((p) => ({
        sourceUrl: thsPhotoUrl(p.publicId),
        width: p.width ?? null,
        height: p.height ?? null,
        caption: p.description || null,
      })),
      availability: upcoming.map((a) => ({
        externalId: String(a.id),
        startDate: a.startDate,
        endDate: a.endDate,
        attributes: {
          confirmed: a.isConfirmed ?? false,
          reviewing: a.isReviewing ?? false,
          applicants: a.numberOfApplicants ?? null,
        },
      })),
      // Drop sitter profiles attached to past assignments: not ours to keep.
      raw: { ...l, assignments: (l.assignments ?? []).map(({ profile: _p, ...a }) => a) },
    };

    return listing;
  },
};
