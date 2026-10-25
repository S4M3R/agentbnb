import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";

// A member's profile: what hosts and guests see about them at /people/[id]. Members fill it in on
// /me/profile, by telling the chat agent, or through PATCH /api/v1/me. Email stays private: only the
// member sees it (/me/profile), the browser agent signs up and prefills logins with it, and we email
// them updates. One email per member (users.email is unique); logins per site live in the Keychain.

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
  /** Private. Not accepted by PATCH /api/v1/me, where it's the registration identity. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "That email is too long.")
    .transform((v) => v || null)
    .pipe(z.email("That doesn't look like an email address.").nullable())
    .nullable()
    .optional()
    .describe("Private: the email they sign up on sites with and where we send updates. Never shown. null removes it."),
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

/** A profile change we can explain to the member, e.g. an email that's someone else's. */
export class ProfileError extends Error {
  constructor(
    message: string,
    readonly field?: keyof ProfileUpdate,
  ) {
    super(message);
  }
}

const EMAIL_TAKEN = "That email belongs to another AgentBnB account.";

/** Postgres unique_violation, from the driver or wrapped by Drizzle. */
function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Apply a validated update. Returns the profile as saved. An email another member has throws a
 * ProfileError (we never merge accounts here; sign-in will handle that).
 */
export async function updateProfile(userId: string, update: Partial<ProfileUpdate>) {
  const fields = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
  if (fields.email) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${fields.email}`, ne(users.id, userId)));
    if (taken) throw new ProfileError(EMAIL_TAKEN, "email");
  }
  if (Object.keys(fields).length) {
    try {
      await db.update(users).set(fields).where(eq(users.id, userId));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ProfileError(EMAIL_TAKEN, "email");
      throw err;
    }
  }
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
