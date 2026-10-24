import { put } from "@vercel/blob";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { listingAvailability, listingPhotos, listings, users } from "@/db/schema";
import { marketFor } from "./markets";

export const NewInternalListing = z.object({
  host: z.object({
    email: z.email(),
    name: z.string().min(1),
    bio: z.string().optional(),
  }),
  type: z.enum(["couch", "private_room", "shared_room", "entire_place"]),
  title: z.string().min(1),
  description: z.string().optional(),
  houseRules: z.string().optional(),
  address: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string(),
  region: z.string().optional(),
  countryCode: z.string().length(2).default("US"),
  lat: z.number().optional(),
  lng: z.number().optional(),
  maxGuests: z.number().int().positive().optional(),
  amenities: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  availability: z
    .array(z.object({ startDate: z.iso.date(), endDate: z.iso.date() }))
    .default([]),
});

/** Create a listing on our own network (host is upserted by email). */
export async function createInternalListing(input: z.infer<typeof NewInternalListing>) {
  const { host, availability, ...fields } = input;

  const [hostRow] = await db
    .insert(users)
    .values({ email: host.email, name: host.name, bio: host.bio })
    .onConflictDoUpdate({ target: users.email, set: { name: sql`excluded.name` } })
    .returning({ id: users.id });

  const [listing] = await db
    .insert(listings)
    .values({
      ...fields,
      sourceId: "internal",
      hostUserId: hostRow.id,
      priceModel: "free",
      locationPrecision: fields.lat != null ? "exact" : "city",
      market: marketFor(fields.lat, fields.lng),
      firstSeenAt: new Date(),
    })
    .returning();

  if (availability.length) {
    await db
      .insert(listingAvailability)
      .values(availability.map((a) => ({ listingId: listing.id, ...a })));
  }
  return listing;
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Upload a photo for one of our own listings to Vercel Blob and attach it. */
export async function addListingPhoto(listingId: string, file: File, caption?: string) {
  const [listing] = await db
    .select({ id: listings.id, sourceId: listings.sourceId })
    .from(listings)
    .where(eq(listings.id, listingId));
  if (!listing) throw new ListingError(404, "listing not found");
  if (listing.sourceId !== "internal") {
    throw new ListingError(400, "photos can only be uploaded to internal listings");
  }
  if (!file.type.startsWith("image/")) throw new ListingError(400, "file must be an image");
  if (file.size > MAX_PHOTO_BYTES) throw new ListingError(400, "image must be 10 MB or less");

  const blob = await put(`listings/${listingId}/${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type,
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listingPhotos)
    .where(eq(listingPhotos.listingId, listingId));

  const [photo] = await db
    .insert(listingPhotos)
    .values({
      listingId,
      url: blob.url,
      blobPathname: blob.pathname,
      position: count,
      caption: caption ?? null,
    })
    .returning();
  return photo;
}

export class ListingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
