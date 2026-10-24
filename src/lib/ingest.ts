import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  externalHosts,
  listingAvailability,
  listingPhotos,
  listings,
  scrapeRuns,
} from "@/db/schema";
import { marketFor } from "./markets";
import type { NormalizedListing } from "./sources";

function contentHash(item: NormalizedListing) {
  const { raw: _raw, ...rest } = item;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

async function upsertHost(sourceId: string, host: NonNullable<NormalizedListing["host"]>) {
  const values = {
    sourceId,
    externalId: host.externalId,
    displayName: host.displayName ?? null,
    profileUrl: host.profileUrl ?? null,
    avatarUrl: host.avatarUrl ?? null,
    languages: host.languages ?? [],
    referenceCount: host.referenceCount ?? null,
    rating: host.rating ?? null,
    memberSince: host.memberSince ?? null,
  };
  const [row] = await db
    .insert(externalHosts)
    .values(values)
    .onConflictDoUpdate({
      target: [externalHosts.sourceId, externalHosts.externalId],
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: externalHosts.id });
  return row.id;
}

/** Upsert one normalized listing. Returns whether it was created, updated, or unchanged. */
export async function upsertListing(sourceId: string, item: NormalizedListing) {
  const now = new Date();
  const hash = contentHash(item);
  const externalHostId = item.host ? await upsertHost(sourceId, item.host) : null;

  const { host: _h, photos, availability, ...fields } = item;
  const values = {
    ...fields,
    sourceId,
    externalHostId,
    market: marketFor(item.lat, item.lng),
    status: "active" as const,
    contentHash: hash,
    lastSeenAt: now,
    lastScrapedAt: now,
  };

  const [existing] = await db
    .select({ id: listings.id, contentHash: listings.contentHash })
    .from(listings)
    .where(and(eq(listings.sourceId, sourceId), eq(listings.externalId, item.externalId)));

  if (existing && existing.contentHash === hash) {
    await db
      .update(listings)
      .set({ lastSeenAt: now, lastScrapedAt: now, status: "active" })
      .where(eq(listings.id, existing.id));
    return { id: existing.id, result: "unchanged" as const };
  }

  const [row] = await db
    .insert(listings)
    .values({ ...values, firstSeenAt: now })
    .onConflictDoUpdate({ target: [listings.sourceId, listings.externalId], set: values })
    .returning({ id: listings.id });

  // Scraped photos/availability are owned by the source: replace wholesale.
  await db.batch([
    db.delete(listingPhotos).where(eq(listingPhotos.listingId, row.id)),
    db.delete(listingAvailability).where(eq(listingAvailability.listingId, row.id)),
    ...(photos.length
      ? [
          db.insert(listingPhotos).values(
            photos.map((p, i) => ({
              listingId: row.id,
              url: p.sourceUrl,
              sourceUrl: p.sourceUrl,
              position: i,
              width: p.width ?? null,
              height: p.height ?? null,
              caption: p.caption ?? null,
            })),
          ),
        ]
      : []),
    ...(availability.length
      ? [
          db.insert(listingAvailability).values(
            availability.map((a) => ({
              listingId: row.id,
              externalId: a.externalId ?? null,
              startDate: a.startDate,
              endDate: a.endDate,
              attributes: a.attributes ?? {},
            })),
          ),
        ]
      : []),
  ]);

  return { id: row.id, result: existing ? ("updated" as const) : ("created" as const) };
}

export async function startRun(sourceId: string, market: string | null) {
  const [run] = await db.insert(scrapeRuns).values({ sourceId, market }).returning();
  return run;
}

export async function recordBatch(
  runId: string,
  counts: { found: number; created: number; updated: number },
) {
  await db
    .update(scrapeRuns)
    .set({
      listingsFound: sql`${scrapeRuns.listingsFound} + ${counts.found}`,
      listingsCreated: sql`${scrapeRuns.listingsCreated} + ${counts.created}`,
      listingsUpdated: sql`${scrapeRuns.listingsUpdated} + ${counts.updated}`,
    })
    .where(eq(scrapeRuns.id, runId));
}

/**
 * Close a run. On success, listings in the run's market that weren't seen
 * during the run are marked `gone`.
 */
export async function finishRun(runId: string, opts: { error?: string | null }) {
  const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId));
  if (!run) throw new Error(`Unknown run ${runId}`);

  let gone = 0;
  if (!opts.error && run.market) {
    const rows = await db
      .update(listings)
      .set({ status: "gone" })
      .where(
        and(
          eq(listings.sourceId, run.sourceId),
          eq(listings.market, run.market),
          eq(listings.status, "active"),
          lt(listings.lastSeenAt, run.startedAt),
        ),
      )
      .returning({ id: listings.id });
    gone = rows.length;
  }

  const [updated] = await db
    .update(scrapeRuns)
    .set({
      status: opts.error ? "failed" : "succeeded",
      error: opts.error ?? null,
      listingsGone: gone,
      finishedAt: new Date(),
    })
    .where(eq(scrapeRuns.id, runId))
    .returning();
  return updated;
}
