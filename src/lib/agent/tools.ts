import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { and, count, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MARKETS } from "@/lib/markets";
import type { WebSession } from "@/lib/session";
import { applyTools } from "./apply-tools";
import { hostingTools } from "./hosting-tools";

const { listings, listingAvailability: avail, listingPhotos, sources, externalHosts } = schema;

const LISTING_TYPES = schema.listingType.enumValues;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clip(text: string | null | undefined, max: number) {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function marketFromText(location: string) {
  const q = location.toLowerCase().trim();
  if (q.length < 6) return null;
  return MARKETS.find((m) => {
    const name = m.name.toLowerCase();
    return q === m.id || name.includes(q) || q.includes(name);
  });
}

/** Short, source-specific facts worth showing on a card. */
function highlights(sourceId: string, attrs: Record<string, unknown>) {
  const out: string[] = [];
  if (sourceId === "trustedhousesitters") {
    const animals = Array.isArray(attrs.animals) ? (attrs.animals as { name: string; count: number }[]) : [];
    const pets = animals.map((a) => `${a.count} ${a.name}${a.count === 1 ? "" : "s"}`).join(", ");
    if (pets) out.push(pets);
    if (typeof attrs.homeType === "string") out.push(attrs.homeType);
    if (attrs.familyFriendly) out.push("family friendly");
  } else if (sourceId === "workaway") {
    if (typeof attrs.minStay === "string") out.push(`min stay: ${attrs.minStay.toLowerCase()}`);
    if (Array.isArray(attrs.helpTypes)) out.push(...(attrs.helpTypes as string[]).slice(0, 2));
    if (attrs.digitalNomads) out.push("digital nomads ok");
  }
  return out.slice(0, 4);
}

function locationLabel(l: {
  neighborhood: string | null;
  city: string | null;
  subregion: string | null;
  region: string | null;
}) {
  const place = l.city ? [l.neighborhood, l.city] : [l.subregion];
  return [...place, l.region].filter(Boolean).join(", ") || null;
}

async function loadPhotos(ids: string[], perListing: number) {
  if (!ids.length) return new Map<string, string[]>();
  const rows = await db
    .select({ listingId: listingPhotos.listingId, url: listingPhotos.url })
    .from(listingPhotos)
    .where(and(inArray(listingPhotos.listingId, ids), sql`${listingPhotos.position} < ${perListing}`))
    .orderBy(listingPhotos.listingId, listingPhotos.position);
  const byListing = new Map<string, string[]>();
  for (const r of rows) byListing.set(r.listingId, [...(byListing.get(r.listingId) ?? []), r.url]);
  return byListing;
}

/**
 * A date window someone could still apply for: not already filled (TrustedHousesitters marks
 * those `confirmed`) and, for house sits, not already under way. Needs `listings` in scope.
 */
function openWindow(from: string) {
  return and(
    eq(avail.kind, "available"),
    sql`${avail.endDate} >= ${from}`,
    sql`coalesce((${avail.attributes}->>'confirmed')::boolean, false) = false`,
    sql`(${listings.type} <> 'house_sit' or ${avail.startDate} >= ${today()})`,
  );
}

type Window = { listingId: string; startDate: string; endDate: string; attributes: Record<string, unknown> };

async function loadWindows(ids: string[], from: string) {
  const byListing = new Map<string, Window[]>();
  if (!ids.length) return byListing;
  const rows = await db
    .select({
      listingId: avail.listingId,
      startDate: avail.startDate,
      endDate: avail.endDate,
      attributes: avail.attributes,
    })
    .from(avail)
    .innerJoin(listings, eq(listings.id, avail.listingId))
    .where(and(inArray(avail.listingId, ids), openWindow(from)))
    .orderBy(avail.startDate);
  for (const r of rows) byListing.set(r.listingId, [...(byListing.get(r.listingId) ?? []), r]);
  return byListing;
}

const searchStays = tool({
  description:
    "Search every stay we know about: house sits, work exchanges and couches from external marketplaces plus " +
    "AgentBnB's own hosts. Returns the best matches as cards the user sees, plus a total count. " +
    "Call it again with different filters to refine.",
  inputSchema: z.object({
    location: z
      .string()
      .optional()
      .describe('City, neighborhood, county, state or market, e.g. "Oakland", "Marin", "SF Bay Area".'),
    radiusKm: z
      .number()
      .positive()
      .max(200)
      .optional()
      .describe("Also include listings within this many km of `location` (city-level precision)."),
    startDate: isoDate.optional().describe("Arrival date. Listings must be open at some point in the range."),
    endDate: isoDate.optional().describe("Departure date. Defaults to startDate."),
    types: z.array(z.enum(LISTING_TYPES)).optional().describe("Only these kinds of stay."),
    sources: z.array(z.string()).optional().describe('Source ids, e.g. ["trustedhousesitters", "workaway"].'),
    animals: z
      .array(z.string())
      .optional()
      .describe('House sits caring for any of these animals, singular: "dog", "cat", "bird", ...'),
    noPets: z.boolean().optional().describe("Only house sits with no animals to care for."),
    keywords: z.string().optional().describe("Free text matched against title, description and expectations."),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  execute: async (input) => {
    const from = input.startDate ?? today();
    const to = input.endDate ?? input.startDate;
    const where: SQL[] = [eq(listings.status, "active")];
    let center: { lat: number; lng: number } | null = null;

    if (input.location) {
      const market = marketFromText(input.location);
      const text = sql`concat_ws(' ', ${listings.neighborhood}, ${listings.city}, ${listings.subregion}, ${listings.region}, ${listings.title}) ilike ${`%${input.location}%`}`;
      if (market) {
        where.push(eq(listings.market, market.id));
      } else if (input.radiusKm) {
        const [c] = await db
          .select({ lat: sql<number | null>`avg(${listings.lat})`, lng: sql<number | null>`avg(${listings.lng})` })
          .from(listings)
          .where(and(sql`${listings.city} ilike ${input.location}`, isNotNull(listings.lat)));
        center = c?.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null;
        where.push(center ? sql`${distanceKm(center)} <= ${input.radiusKm}` : text);
      } else {
        where.push(text);
      }
    }

    const overlaps = and(
      eq(avail.listingId, listings.id),
      openWindow(from),
      to ? sql`${avail.startDate} <= ${to}` : undefined,
    );
    if (input.startDate) {
      where.push(sql`exists (select 1 from ${avail} where ${overlaps})`);
    } else {
      // No dates: drop listings whose every window is already in the past.
      where.push(
        sql`(not exists (select 1 from ${avail} where ${avail.listingId} = ${listings.id}) or exists (select 1 from ${avail} where ${overlaps}))`,
      );
    }

    if (input.types?.length) where.push(inArray(listings.type, input.types));
    if (input.sources?.length) where.push(inArray(listings.sourceId, input.sources));
    if (input.animals?.length) {
      const names = input.animals.map((a) => a.toLowerCase().replace(/s$/, ""));
      where.push(
        sql`jsonb_typeof(${listings.attributes}->'animals') = 'array' and exists (select 1 from jsonb_array_elements(${listings.attributes}->'animals') e where e->>'name' in ${names})`,
      );
    }
    if (input.noPets) {
      where.push(
        sql`(jsonb_typeof(${listings.attributes}->'animals') is distinct from 'array' or jsonb_array_length(${listings.attributes}->'animals') = 0) and ${listings.type} = 'house_sit'`,
      );
    }
    if (input.keywords) {
      const kw = `%${input.keywords}%`;
      where.push(
        sql`(${listings.title} ilike ${kw} or ${listings.description} ilike ${kw} or ${listings.guestExpectations} ilike ${kw})`,
      );
    }

    const nextStart = sql<string | null>`(select min(${avail.startDate}) from ${avail} where ${overlaps})`;
    const filter = and(...where);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: listings.id,
          title: listings.title,
          type: listings.type,
          sourceId: listings.sourceId,
          sourceName: sources.name,
          externalUrl: listings.externalUrl,
          neighborhood: listings.neighborhood,
          city: listings.city,
          subregion: listings.subregion,
          region: listings.region,
          description: listings.description,
          maxGuests: listings.maxGuests,
          rating: listings.rating,
          attributes: listings.attributes,
          nextStart,
          distanceKm: center ? sql<number>`round(${distanceKm(center)}::numeric, 1)::float` : sql<null>`null`,
        })
        .from(listings)
        .innerJoin(sources, eq(sources.id, listings.sourceId))
        .where(filter)
        .orderBy(center ? distanceKm(center) : sql`${nextStart} asc nulls last`, desc(listings.lastSeenAt))
        .limit(input.limit),
      db.select({ total: count() }).from(listings).where(filter),
    ]);

    const ids = rows.map((r) => r.id);
    const [photos, windows] = await Promise.all([loadPhotos(ids, 1), loadWindows(ids, from)]);

    const widen = [
      input.location && !input.radiusKm && !marketFromText(input.location) && "add radiusKm: 25",
      input.startDate && "widen the dates by a few days on each side",
      (input.types?.length || input.animals?.length || input.noPets || input.keywords) && "drop a filter",
    ].filter(Boolean);

    return {
      total,
      ...(total < 3 && widen.length && { hint: `Few matches. Search again before replying: ${widen.join(", or ")}.` }),
      results: rows.map((r) => ({
        id: r.id,
        title: clip(r.title, 120),
        type: r.type,
        source: { id: r.sourceId, name: r.sourceName },
        url: r.externalUrl,
        location: locationLabel(r),
        distanceKm: r.distanceKm,
        photo: photos.get(r.id)?.[0] ?? null,
        dates: (windows.get(r.id) ?? [])
          .filter((w) => !to || w.startDate <= to)
          .slice(0, 3)
          .map((w) => ({ start: w.startDate, end: w.endDate })),
        highlights: highlights(r.sourceId, r.attributes),
        summary: clip(r.description, 220),
        maxGuests: r.maxGuests,
        rating: r.rating || null, // 0 means no reviews yet
      })),
    };
  },
});

function distanceKm(c: { lat: number; lng: number }) {
  return sql`(6371 * 2 * asin(sqrt(power(sin(radians(${listings.lat} - ${c.lat}) / 2), 2) + cos(radians(${c.lat})) * cos(radians(${listings.lat})) * power(sin(radians(${listings.lng} - ${c.lng}) / 2), 2))))`;
}

const getListing = tool({
  description:
    "Full details for one listing from searchStays: description, what the host expects, house rules, " +
    "pets, host profile, photos and every upcoming date window. Use before recommending or drafting a message.",
  inputSchema: z.object({ id: z.uuid().describe("Listing id from searchStays.") }),
  execute: async ({ id }) => {
    const [row] = await db
      .select({ listing: listings, sourceName: sources.name, host: externalHosts })
      .from(listings)
      .innerJoin(sources, eq(sources.id, listings.sourceId))
      .leftJoin(externalHosts, eq(externalHosts.id, listings.externalHostId))
      .where(eq(listings.id, id));
    if (!row) return { error: "Listing not found" as const };

    const l = row.listing;
    const [photos, windows] = await Promise.all([loadPhotos([id], 6), loadWindows([id], today())]);
    const attributes = Object.fromEntries(
      Object.entries(l.attributes).map(([k, v]) => [k, typeof v === "string" ? clip(v, 800) : v]),
    );

    return {
      id: l.id,
      title: clip(l.title, 200),
      type: l.type,
      source: { id: l.sourceId, name: row.sourceName },
      url: l.externalUrl,
      location: locationLabel(l),
      locationPrecision: l.locationPrecision,
      photos: photos.get(id) ?? [],
      dates: (windows.get(id) ?? []).slice(0, 12).map((w) => ({
        start: w.startDate,
        end: w.endDate,
        details: w.attributes,
      })),
      highlights: highlights(l.sourceId, l.attributes),
      description: clip(l.description, 3000),
      guestExpectations: clip(l.guestExpectations, 1500),
      houseRules: clip(l.houseRules, 1000),
      maxGuests: l.maxGuests,
      minNights: l.minNights,
      maxNights: l.maxNights,
      price: { model: l.priceModel, amountCents: l.priceAmountCents, currency: l.currency },
      amenities: l.amenities,
      languages: l.languages,
      attributes,
      rating: l.rating || null,
      host: row.host && {
        name: row.host.displayName,
        profileUrl: row.host.profileUrl,
        avatarUrl: row.host.avatarUrl,
        references: row.host.referenceCount,
        rating: row.host.rating,
        memberSince: row.host.memberSince,
      },
      lastSeenAt: l.lastSeenAt,
    };
  },
});

const getCoverage = tool({
  description:
    "What AgentBnB can currently search: listing counts per source and type, the cities with the most " +
    "listings, and the date range covered. Use when the user asks what's available or a search comes back empty.",
  inputSchema: z.object({}),
  execute: async () => {
    const active = eq(listings.status, "active");
    const [bySource, byCity, [range]] = await Promise.all([
      db
        .select({ id: sources.id, name: sources.name, kind: sources.kind, listings: count(listings.id) })
        .from(sources)
        .leftJoin(listings, and(eq(listings.sourceId, sources.id), active))
        .where(eq(sources.enabled, true))
        .groupBy(sources.id)
        .orderBy(desc(count(listings.id))),
      db
        .select({ city: listings.city, region: listings.region, listings: count() })
        .from(listings)
        .where(and(active, isNotNull(listings.city)))
        .groupBy(listings.city, listings.region)
        .orderBy(desc(count()))
        .limit(15),
      db
        .select({ first: sql<string>`min(${avail.startDate})`, last: sql<string>`max(${avail.endDate})` })
        .from(avail)
        .where(sql`${avail.endDate} >= ${today()}`),
    ]);
    return {
      markets: MARKETS.map((m) => m.name),
      sources: bySource.map((s) => ({ ...s, searchable: s.listings > 0 })),
      topCities: byCity,
      dateRange: range,
    };
  },
});

export function createAgentTools(session: WebSession) {
  return { searchStays, getListing, getCoverage, ...hostingTools(session), ...applyTools(session) };
}

export type AgentUIMessage = UIMessage<never, UIDataTypes, InferUITools<ReturnType<typeof createAgentTools>>>;
