import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { geocodeLoose, publicCoordinates, reverseGeocode } from "@/lib/geocode";
import { marketFor } from "@/lib/markets";
import { ARRANGEMENTS, getNetwork, type Arrangement } from "./networks";

// A host's own place on the internal network. The agent drafts it from the conversation and
// photos, the host approves, and it goes live (status draft → active). External copies live in
// listing_publications (./publish.ts).

const { listings, listingPhotos, listingAvailability, listingPublications } = schema;

export const HOST_LISTING_TYPES = ["couch", "private_room", "shared_room", "entire_place"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const ListingDraft = z.object({
  listingId: z
    .uuid()
    .optional()
    .describe("Omit to create the host's listing; pass it to update. Optional fields you omit keep their value."),
  address: z
    .string()
    .min(3)
    .optional()
    .describe(
      "Street address, or at least neighborhood + city, or the label from askForLocation. Kept private. " +
        "Creating needs this or `point`.",
    ),
  point: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional()
    .describe("Exact spot from askForLocation (GPS or map pin). Preferred over geocoding the address."),
  arrangement: z.enum(ARRANGEMENTS).describe(
    "hosting: free stay while the host is home. house_sit: the host is away and someone minds the home/pets. " +
      "exchange: a bed in exchange for a few hours of help.",
  ),
  type: z.enum(HOST_LISTING_TYPES).describe("What the guest gets."),
  title: z.string().min(3).max(120),
  description: z.string().min(20).max(4000).describe("Warm, specific, first person, in the host's voice."),
  maxGuests: z.number().int().min(1).max(20).optional(),
  houseRules: z.string().max(2000).optional(),
  amenities: z.array(z.string()).max(30).optional().describe('Short labels, e.g. "wifi", "washer", "bike storage".'),
  languages: z.array(z.string()).max(10).optional(),
  pets: z.string().max(200).optional().describe('Animals living there (or to care for), e.g. "2 cats".'),
  forCyclists: z.boolean().optional().describe("Host welcomes touring cyclists (fits Warmshowers)."),
  photoUrls: z
    .array(z.url())
    .max(20)
    .optional()
    .describe("Photo URLs the user attached in this chat, best first. Replaces the current photos; omit to keep them."),
  availability: z
    .array(z.object({ startDate: isoDate, endDate: isoDate }))
    .max(20)
    .optional()
    .describe("Date ranges the place is open. Replaces the current ones."),
  hostName: z.string().min(1).max(80).optional().describe("What guests should call the host."),
});

export type ListingDraft = z.infer<typeof ListingDraft>;

export class HostingError extends Error {}

/** Only photos uploaded to our Blob store, never arbitrary URLs. */
function isOurPhoto(url: string) {
  return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com");
}

async function ownedListing(userId: string, listingId: string) {
  const [row] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.hostUserId, userId), eq(listings.sourceId, "internal")));
  if (!row) throw new HostingError("That listing doesn't exist or isn't yours.");
  return row;
}

/** Create or update the host's draft. Returns the listing as the host sees it. */
export async function saveListingDraft(userId: string, input: ListingDraft) {
  const existing = input.listingId ? await ownedListing(userId, input.listingId) : null;
  if (!existing && !input.address && !input.point) {
    throw new HostingError("I need to know where the place is first (ask with askForLocation).");
  }

  let location = {};
  const moved = input.point
    ? input.point.lat !== existing?.lat || input.point.lng !== existing?.lng
    : input.address !== undefined && input.address !== existing?.address;
  if (moved) {
    const place = input.point
      ? await reverseGeocode(input.point.lat, input.point.lng)
      : await geocodeLoose(input.address!);
    if (!place) {
      throw new HostingError(
        input.point
          ? "I couldn't name that spot on the map. Ask them to pick again."
          : `I couldn't find "${input.address}" on the map. Ask them to share their location or pick it on the map.`,
      );
    }
    const coords = publicCoordinates(place);
    location = {
      address: input.address ?? place.label,
      neighborhood: place.neighborhood,
      city: place.city,
      subregion: place.subregion,
      region: place.region,
      countryCode: place.countryCode,
      ...coords,
      locationPrecision: "approximate" as const,
      market: marketFor(coords.lat, coords.lng),
    };
  }

  const photoUrls = input.photoUrls?.filter(isOurPhoto);
  // Fields left out keep their current value (Drizzle skips undefined), so edits can be partial.
  const fields = {
    type: input.type,
    title: input.title,
    description: input.description,
    maxGuests: input.maxGuests,
    houseRules: input.houseRules,
    amenities: input.amenities,
    languages: input.languages,
    priceModel: input.arrangement === "exchange" ? ("exchange" as const) : ("free" as const),
    attributes: {
      ...existing?.attributes,
      arrangement: input.arrangement,
      ...(input.pets !== undefined && { pets: input.pets }),
      ...(input.forCyclists !== undefined && { forCyclists: input.forCyclists }),
    },
    ...location,
  };

  let listingId = existing?.id;
  if (existing) {
    await db.update(listings).set(fields).where(eq(listings.id, existing.id));
  } else {
    const [row] = await db
      .insert(listings)
      .values({ ...fields, sourceId: "internal", hostUserId: userId, status: "draft" })
      .returning({ id: listings.id });
    listingId = row.id;
  }
  const id = listingId!;

  if (photoUrls?.length) {
    await db.batch([
      db.delete(listingPhotos).where(eq(listingPhotos.listingId, id)),
      ...photoUrls.map((url, position) =>
        db.insert(listingPhotos).values({ listingId: id, url, blobPathname: new URL(url).pathname.slice(1), position }),
      ),
    ]);
  }
  if (input.availability) {
    await db.batch([
      db.delete(listingAvailability).where(eq(listingAvailability.listingId, id)),
      ...input.availability.map((a) => db.insert(listingAvailability).values({ listingId: id, ...a })),
    ]);
  }

  return getHostListing(userId, id);
}

/** Put the listing live on AgentBnB's own network (searchable by guests). */
export async function publishInternal(userId: string, listingId: string) {
  const l = await ownedListing(userId, listingId);
  const missing = [!l.address && "an address", !l.description && "a description"].filter(Boolean);
  if (missing.length) throw new HostingError(`The listing still needs ${missing.join(" and ")}.`);
  const now = new Date();
  await db
    .update(listings)
    .set({ status: "active", firstSeenAt: l.firstSeenAt ?? now, lastSeenAt: now })
    .where(eq(listings.id, l.id));
  return getHostListing(userId, l.id);
}

export async function pauseInternal(userId: string, listingId: string) {
  const l = await ownedListing(userId, listingId);
  await db.update(listings).set({ status: "paused" }).where(eq(listings.id, l.id));
  return getHostListing(userId, l.id);
}

export function arrangementOf(attributes: Record<string, unknown>): Arrangement {
  const a = attributes.arrangement;
  return ARRANGEMENTS.includes(a as Arrangement) ? (a as Arrangement) : "hosting";
}

/** The host's view of their listing: private address, photos, dates and where it's published. */
export async function getHostListing(userId: string, listingId: string) {
  const l = await ownedListing(userId, listingId);
  const [photos, dates, pubs] = await Promise.all([
    db
      .select({ url: listingPhotos.url })
      .from(listingPhotos)
      .where(eq(listingPhotos.listingId, l.id))
      .orderBy(asc(listingPhotos.position)),
    db
      .select({ start: listingAvailability.startDate, end: listingAvailability.endDate })
      .from(listingAvailability)
      .where(and(eq(listingAvailability.listingId, l.id), eq(listingAvailability.kind, "available")))
      .orderBy(asc(listingAvailability.startDate)),
    db
      .select({
        id: listingPublications.id,
        network: listingPublications.sourceId,
        status: listingPublications.status,
        externalUrl: listingPublications.externalUrl,
      })
      .from(listingPublications)
      .where(eq(listingPublications.listingId, l.id)),
  ]);

  return {
    id: l.id,
    status: l.status,
    title: l.title,
    type: l.type,
    arrangement: arrangementOf(l.attributes),
    description: l.description,
    address: l.address,
    publicLocation: [l.neighborhood, l.city, l.region].filter(Boolean).join(", ") || null,
    countryCode: l.countryCode,
    maxGuests: l.maxGuests,
    houseRules: l.houseRules,
    amenities: l.amenities,
    pets: (l.attributes.pets as string | null) ?? null,
    forCyclists: l.attributes.forCyclists === true,
    photos: photos.map((p) => p.url),
    dates,
    publications: pubs.map((p) => ({ ...p, networkName: getNetwork(p.network)?.name ?? p.network })),
  };
}

export type HostListing = Awaited<ReturnType<typeof getHostListing>>;

/** All of the host's listings, newest first. */
export async function listHostListings(userId: string) {
  const rows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        eq(listings.hostUserId, userId),
        eq(listings.sourceId, "internal"),
        inArray(listings.status, ["draft", "active", "paused"]),
      ),
    )
    .orderBy(desc(listings.updatedAt));
  return Promise.all(rows.map((r) => getHostListing(userId, r.id)));
}
