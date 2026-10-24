import type { listings } from "@/db/schema";

type ListingInsert = typeof listings.$inferInsert;

/** Source-agnostic shape every scraper adapter maps its raw data into. */
export type NormalizedListing = Pick<
  ListingInsert,
  | "type"
  | "title"
  | "description"
  | "guestExpectations"
  | "houseRules"
  | "neighborhood"
  | "city"
  | "subregion"
  | "region"
  | "countryCode"
  | "lat"
  | "lng"
  | "locationPrecision"
  | "maxGuests"
  | "minNights"
  | "maxNights"
  | "priceModel"
  | "priceAmountCents"
  | "currency"
  | "amenities"
  | "languages"
  | "attributes"
  | "rating"
> &
  Partial<Pick<ListingInsert, "pricePeriod">> & {
  externalId: string;
  externalUrl: string;
  host?: {
    externalId: string;
    displayName?: string | null;
    profileUrl?: string | null;
    avatarUrl?: string | null;
    languages?: string[];
    referenceCount?: number | null;
    rating?: number | null;
    memberSince?: Date | null;
  };
  photos: { sourceUrl: string; width?: number | null; height?: number | null; caption?: string | null }[];
  availability: {
    externalId?: string | null;
    startDate: string; // YYYY-MM-DD
    endDate: string;
    attributes?: Record<string, unknown>;
  }[];
  raw: unknown;
};

export interface SourceAdapter {
  sourceId: string;
  /** Map one raw record (as posted by the browser scraper) to a listing, or null to skip. */
  normalize(raw: unknown): NormalizedListing | null;
}
