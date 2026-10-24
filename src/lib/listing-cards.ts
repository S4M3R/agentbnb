import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Read helpers shared by the agent's tools and the share pages (/s/<id>): photos, open date
// windows and the short facts we show on a listing card.

const { listings, listingAvailability: avail, listingPhotos } = schema;

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function clip(text: string | null | undefined, max: number) {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Short, source-specific facts worth showing on a card. */
export function highlights(sourceId: string, attrs: Record<string, unknown>) {
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
  } else if (sourceId === "internal" && typeof attrs.pets === "string") {
    out.push(attrs.pets);
  }
  return out.slice(0, 4);
}

export function locationLabel(l: {
  neighborhood: string | null;
  city: string | null;
  subregion: string | null;
  region: string | null;
}) {
  const place = l.city ? [l.neighborhood, l.city] : [l.subregion];
  return [...place, l.region].filter(Boolean).join(", ") || null;
}

export async function loadPhotos(ids: string[], perListing: number) {
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
export function openWindow(from: string) {
  return and(
    eq(avail.kind, "available"),
    sql`${avail.endDate} >= ${from}`,
    sql`coalesce((${avail.attributes}->>'confirmed')::boolean, false) = false`,
    sql`(${listings.type} <> 'house_sit' or ${avail.startDate} >= ${today()})`,
  );
}

type Window = { listingId: string; startDate: string; endDate: string; attributes: Record<string, unknown> };

export async function loadWindows(ids: string[], from: string) {
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
