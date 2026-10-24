import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";

// A member's profile: what hosts and guests see about them at /people/[id]. Members fill it in on
// /me/profile, by telling the chat agent, or through PATCH /api/v1/me. Email stays private.

const { users, listings, listingPhotos, listingAvailability } = schema;

/** Empty or whitespace-only text clears the field. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

/** "spanish" → "Spanish"; drops blanks and duplicates. */
function cleanLanguages(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const l = raw.trim().replace(/\s+/g, " ");
    if (!l || seen.has(l.toLowerCase())) continue;
    seen.add(l.toLowerCase());
    out.push(l.charAt(0).toUpperCase() + l.slice(1));
  }
  return out;
}

/** The editable profile fields. Every field is optional: what you leave out keeps its value. */
export const ProfileInput = z.object({
  name: z.string().trim().min(1, "Add your name.").max(80, "Keep your name under 80 characters.").optional(),
  avatarUrl: z
    .url({ protocol: /^https$/, message: "The photo must be an https URL." })
    .max(2048)
    .nullable()
    .optional()
    .describe("Profile photo URL (https). null removes it."),
  bio: optionalText(1000).describe("A few sentences about them, in their voice."),
  homeCity: optionalText(120).describe('Where they live, e.g. "Buenos Aires, Argentina".'),
  languages: z
    .array(z.string().trim().max(40, "Language names are short."))
    .max(10, "Up to 10 languages.")
    .optional()
    .transform((l) => l && cleanLanguages(l))
    .describe('Languages they speak, e.g. ["Spanish", "English"]. Replaces the list.'),
});

export type ProfileInput = z.input<typeof ProfileInput>;
export type ProfileUpdate = z.output<typeof ProfileInput>;

const profileColumns = {
  id: users.id,
  name: users.name,
  avatarUrl: users.avatarUrl,
  bio: users.bio,
  homeCity: users.homeCity,
  languages: users.languages,
  verified: users.verified,
  memberSince: users.createdAt,
};

/** The member's own profile, including their private email. */
export async function getMyProfile(userId: string) {
  const [row] = await db
    .select({ ...profileColumns, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

export type MyProfile = NonNullable<Awaited<ReturnType<typeof getMyProfile>>>;

/** Apply a validated update. Returns the profile as saved. */
export async function updateProfile(userId: string, update: ProfileUpdate) {
  const fields = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length) await db.update(users).set(fields).where(eq(users.id, userId));
  return (await getMyProfile(userId))!;
}

/** Where a member's public profile lives. */
export function profilePath(userId: string) {
  return `/people/${userId}`;
}

/**
 * What anyone can see about a member: no email, and for their places only the area (never the
 * address or coordinates). Null for unknown or malformed ids.
 */
export async function getPublicProfile(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [person] = await db.select(profileColumns).from(users).where(eq(users.id, id));
  if (!person) return null;

  const places = await db
    .select({
      id: listings.id,
      title: listings.title,
      type: listings.type,
      neighborhood: listings.neighborhood,
      city: listings.city,
      region: listings.region,
      maxGuests: listings.maxGuests,
    })
    .from(listings)
    .where(and(eq(listings.hostUserId, id), eq(listings.sourceId, "internal"), eq(listings.status, "active")))
    .orderBy(sql`${listings.updatedAt} desc`)
    .limit(12);

  const ids = places.map((p) => p.id);
  const today = new Date().toISOString().slice(0, 10);
  const [photos, dates] = ids.length
    ? await Promise.all([
        db
          .select({ listingId: listingPhotos.listingId, url: listingPhotos.url })
          .from(listingPhotos)
          .where(inArray(listingPhotos.listingId, ids))
          .orderBy(asc(listingPhotos.position)),
        db
          .select({
            listingId: listingAvailability.listingId,
            start: listingAvailability.startDate,
            end: listingAvailability.endDate,
          })
          .from(listingAvailability)
          .where(
            and(
              inArray(listingAvailability.listingId, ids),
              eq(listingAvailability.kind, "available"),
              gte(listingAvailability.endDate, today),
            ),
          )
          .orderBy(asc(listingAvailability.startDate)),
      ])
    : [[], []];

  return {
    ...person,
    listings: places.map(({ neighborhood, city, region, ...p }) => {
      const next = dates.find((d) => d.listingId === p.id);
      return {
        ...p,
        place: [neighborhood, city].filter(Boolean).join(", ") || region || null,
        photo: photos.find((ph) => ph.listingId === p.id)?.url ?? null,
        nextOpen: next ? { start: next.start < today ? today : next.start, end: next.end } : null,
      };
    }),
  };
}

export type PublicProfile = NonNullable<Awaited<ReturnType<typeof getPublicProfile>>>;
