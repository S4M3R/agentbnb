import type { NormalizedListing, SourceAdapter } from "./types";

/** What the browser scraper extracts from api.wwoof.net/api/hosts/<id> (public, no login). */
type WwoofUsaRaw = {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  travelDetails: string | null;
  region: string | null;
  lat: number | null; // rounded to ~1 km by the scraper
  lng: number | null;
  activities: string[];
  methodologies: string[];
  openingMonths: string[]; // "01".."12"
  stays: string[];
  lodgings: string[];
  diets: string[];
  tags: string[];
  languages: string[];
  isCertifiedOrganic: boolean | null;
  capacity: number | null;
  childrenOk: boolean | null;
  petsOk: boolean | null;
  isVerified: boolean | null;
  hostType: string | null;
  areaInHectares: number | null;
  immediateAvailabilityExpireAt: string | null;
  reviewCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  photos: { id: number; url: string | null; isThumbnail: boolean }[];
};

/** Accepted stay lengths -> [min nights, max nights (null = open-ended)]. */
const STAYS: Record<string, [number, number | null]> = {
  "single-day": [1, 1],
  weekend: [2, 3],
  "less-than-a-week": [3, 6],
  "one-two-weeks": [7, 14],
  "three-four-weeks": [21, 28],
  "more-than-a-month": [31, null],
};

const label = (slug: string) => slug.replace(/-/g, " ");

function stayBounds(stays: string[]) {
  const known = stays.map((s) => STAYS[s]).filter(Boolean);
  if (!known.length) return { minNights: null, maxNights: null };
  const minNights = Math.min(...known.map(([min]) => min));
  const maxNights = known.some(([, max]) => max == null) ? null : Math.max(...known.map(([, max]) => max ?? 0));
  return { minNights, maxNights };
}

/** Collapse the host's opening months over the next 12 months into date ranges. */
function monthRanges(openingMonths: string[]) {
  const open = new Set(openingMonths.map((m) => Number(m) - 1));
  const now = new Date();
  const start = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const ranges: { start: number; end: number }[] = [];
  for (let idx = start; idx < start + 12; idx++) {
    if (!open.has(idx % 12)) continue;
    const last = ranges.at(-1);
    if (last && last.end + 1 === idx) last.end = idx;
    else ranges.push({ start: idx, end: idx });
  }
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return ranges.map((r) => ({
    externalId: null,
    startDate: iso(new Date(Date.UTC(Math.floor(r.start / 12), r.start % 12, 1))),
    endDate: iso(new Date(Date.UTC(Math.floor(r.end / 12), (r.end % 12) + 1, 0))),
    attributes: { granularity: "month", basis: "openingMonths" },
  }));
}

export const wwoofUsa: SourceAdapter = {
  sourceId: "wwoof-usa",

  normalize(input) {
    const w = input as WwoofUsaRaw;
    if (!w?.id || !w.title?.trim()) return null;

    const { minNights, maxNights } = stayBounds(w.stays ?? []);
    const immediate =
      w.immediateAvailabilityExpireAt != null && new Date(w.immediateAvailabilityExpireAt) > new Date();

    const listing: NormalizedListing = {
      externalId: w.id,
      externalUrl: w.url,
      type: "farm_stay",
      title: w.title.trim(),
      description: w.description?.trim() || null,
      guestExpectations: w.activities?.length
        ? `Help with: ${w.activities.map(label).join(", ")}`
        : null,
      houseRules: null,
      neighborhood: null,
      city: null,
      subregion: null,
      region: w.region,
      countryCode: "US",
      lat: w.lat,
      lng: w.lng,
      locationPrecision: "approximate",
      maxGuests: w.capacity ?? null,
      minNights,
      maxNights,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: (w.lodgings ?? []).map(label),
      languages: w.languages ?? [],
      rating: null,
      attributes: {
        hostType: w.hostType,
        activities: w.activities,
        methodologies: w.methodologies,
        lodgings: w.lodgings,
        diets: w.diets,
        stays: w.stays,
        tags: w.tags,
        openingMonths: w.openingMonths,
        certifiedOrganic: w.isCertifiedOrganic,
        childrenOk: w.childrenOk,
        petsOk: w.petsOk,
        verified: w.isVerified,
        areaInHectares: w.areaInHectares,
        immediatelyAvailable: immediate,
        travelDetails: w.travelDetails?.trim() || null,
        reviewCount: w.reviewCount,
        membershipRequired: true, // WWOOF-USA membership is needed to contact hosts
      },
      host: {
        externalId: w.id,
        profileUrl: w.url,
        languages: w.languages ?? [],
        referenceCount: w.reviewCount,
      },
      // Thumbnail first, so it becomes the cover photo.
      photos: [...(w.photos ?? [])]
        .filter((p) => p.url)
        .sort((a, b) => Number(b.isThumbnail) - Number(a.isThumbnail))
        .map((p) => ({ sourceUrl: p.url as string })),
      availability: monthRanges(w.openingMonths ?? []),
      raw: w,
    };
    return listing;
  },
};

export default wwoofUsa;
