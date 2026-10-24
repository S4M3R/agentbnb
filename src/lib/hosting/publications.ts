import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getHostListing, HostingError } from "./listings";
import { getNetwork } from "./networks";

// Where a host's listing stands on each external network (listing_publications), and the host's
// controls over it. The browser agent that does the work is in ./browser-agent.ts.

const { listings, listingPublications: pubs } = schema;

type Publication = typeof pubs.$inferSelect;

function view(p: Publication) {
  const alive = p.browserSessionId != null;
  return {
    id: p.id,
    listingId: p.listingId,
    network: p.sourceId,
    networkName: getNetwork(p.sourceId)?.name ?? p.sourceId,
    status: p.status,
    statusMessage: p.statusMessage,
    /** Only while a browser session is open; the host can watch and take over. */
    liveViewUrl: alive ? p.liveViewUrl : null,
    externalUrl: p.externalUrl,
    error: p.error,
  };
}

export type PublicationView = ReturnType<typeof view>;

async function owned(userId: string, publicationId: string) {
  const [row] = await db
    .select({ pub: pubs })
    .from(pubs)
    .innerJoin(listings, eq(listings.id, pubs.listingId))
    .where(and(eq(pubs.id, publicationId), eq(listings.hostUserId, userId)));
  if (!row) throw new HostingError("That publication doesn't exist or isn't yours.");
  return row.pub;
}

export async function updatePublication(id: string, set: Partial<typeof pubs.$inferInsert>) {
  const [row] = await db.update(pubs).set(set).where(eq(pubs.id, id)).returning();
  return row;
}

/**
 * Queue the listing for a network. Re-adding one that's live or failed queues it again, which
 * re-syncs the listing there. One that's already being worked on is left alone.
 */
export async function queuePublication(userId: string, listingId: string, networkId: string) {
  const network = getNetwork(networkId);
  if (!network) throw new HostingError(`I can't publish to "${networkId}" yet.`);
  await getHostListing(userId, listingId); // ownership

  const [row] = await db
    .insert(pubs)
    .values({ listingId, sourceId: network.id, statusMessage: `Ready to open ${network.name}` })
    .onConflictDoUpdate({
      target: [pubs.listingId, pubs.sourceId],
      set: {
        status: sql`case when ${pubs.status} in ('running', 'needs_user') then ${pubs.status} else 'queued' end`,
        error: null,
      },
    })
    .returning();
  return view(row);
}

/**
 * Claim the publication for a new run. Returns null when a run already has it (double click,
 * second tab). The caller schedules `runPublication` with `after()`.
 */
export async function claimRun(userId: string, publicationId: string) {
  const pub = await owned(userId, publicationId);
  const [row] = await db
    .update(pubs)
    .set({
      status: "running",
      statusMessage: "Opening a browser…",
      error: null,
      userActedAt: null,
      attempts: sql`${pubs.attempts} + 1`,
    })
    .where(
      and(
        eq(pubs.id, pub.id),
        isNull(pubs.browserSessionId),
        inArray(pubs.status, ["queued", "needs_user", "failed", "live"]),
      ),
    )
    .returning();
  return row ? view(row) : null;
}

/**
 * The host tapped Continue. If a run is waiting on them, wake it; if the last run already ended,
 * start a new one (returns `startRun: true`).
 */
export async function continuePublication(userId: string, publicationId: string) {
  const pub = await owned(userId, publicationId);
  if (pub.browserSessionId) {
    return { publication: view(await updatePublication(pub.id, { userActedAt: new Date(), status: "running" })), startRun: false };
  }
  const claimed = await claimRun(userId, pub.id);
  return { publication: claimed ?? view(pub), startRun: claimed != null };
}

/** The host finished it themselves in the live view. */
export async function markPublished(userId: string, publicationId: string, externalUrl?: string) {
  const pub = await owned(userId, publicationId);
  const now = new Date();
  return view(
    await updatePublication(pub.id, {
      status: "live",
      statusMessage: "You finished it yourself.",
      externalUrl: externalUrl ?? pub.externalUrl,
      publishedAt: pub.publishedAt ?? now,
      lastSyncedAt: now,
    }),
  );
}

export async function stopPublication(userId: string, publicationId: string) {
  const pub = await owned(userId, publicationId);
  return view(await updatePublication(pub.id, { status: "failed", error: "Stopped by you.", statusMessage: "Stopped." }));
}

export async function getPublication(userId: string, publicationId: string) {
  return view(await owned(userId, publicationId));
}
