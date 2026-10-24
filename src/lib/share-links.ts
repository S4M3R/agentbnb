import { and, eq, inArray } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { clip, highlights, loadPhotos, loadWindows, locationLabel, today } from "@/lib/listing-cards";

// Short links (/s/<id>) to listings an agent picked. Another agent (Instinct, ...) sends one to
// its person in iMessage; the page's Open Graph tags and generated image make it unfold into a
// rich preview. Links are public: anyone with the URL sees what's on it, so they only ever show
// public listing fields (never the address). A host's draft can be on a link made for that host.

const { shareLinks, listings, sources, agents, users, externalHosts } = schema;

// No look-alikes (0/O, 1/l/I): people read these out of a message bubble.
const newId = customAlphabet("23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 10);

export class ShareLinkError extends Error {}

export type NewShareLink = {
  title: string;
  note?: string;
  listingIds: string[];
  startDate?: string;
  endDate?: string;
  userId?: string | null;
  agentId?: string | null;
};

/** Listings a link may show: live ones, plus the person's own drafts and paused listings. */
async function visibleListingIds(ids: string[], userId: string | null | undefined) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .select({ id: listings.id, status: listings.status, hostUserId: listings.hostUserId })
    .from(listings)
    .where(inArray(listings.id, ids));
  return new Set(
    rows
      .filter((r) => r.status === "active" || (r.status !== "gone" && userId && r.hostUserId === userId))
      .map((r) => r.id),
  );
}

export async function createShareLink(input: NewShareLink, origin: string) {
  const ids = [...new Set(input.listingIds)];
  const visible = await visibleListingIds(ids, input.userId);
  const listingIds = ids.filter((id) => visible.has(id));
  if (!listingIds.length) throw new ShareLinkError("None of those listings can be shared (unknown or not live).");

  const id = newId();
  await db.insert(shareLinks).values({
    id,
    title: input.title,
    note: input.note ?? null,
    listingIds,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? input.startDate ?? null,
    userId: input.userId ?? null,
    agentId: input.agentId ?? null,
  });
  return { id, url: `${origin}/s/${id}`, title: input.title, listings: listingIds.length };
}

export type SharedListing = {
  id: string;
  title: string;
  type: string;
  status: string;
  source: { id: string; name: string };
  url: string | null;
  location: string | null;
  photos: string[];
  dates: { start: string; end: string }[];
  highlights: string[];
  summary: string | null;
  maxGuests: number | null;
  rating: number | null;
  host: string | null;
};

export type SharedView = Awaited<ReturnType<typeof getShareLink>>;

/** A link and its listings, in the order the agent picked them. Null if there's no such link. */
export async function getShareLink(id: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`share-link:${id}`);

  const [link] = await db
    .select({ link: shareLinks, agentName: agents.name, agentKind: agents.kind })
    .from(shareLinks)
    .leftJoin(agents, eq(agents.id, shareLinks.agentId))
    .where(eq(shareLinks.id, id));
  if (!link) return null;
  const l = link.link;

  const visible = await visibleListingIds(l.listingIds, l.userId);
  const ids = l.listingIds.filter((x) => visible.has(x));
  const from = l.startDate && l.startDate > today() ? l.startDate : today();

  const [rows, photos, windows] = await Promise.all([
    ids.length
      ? db
          .select({
            listing: listings,
            sourceName: sources.name,
            externalHost: externalHosts.displayName,
            internalHost: users.name,
          })
          .from(listings)
          .innerJoin(sources, eq(sources.id, listings.sourceId))
          .leftJoin(externalHosts, eq(externalHosts.id, listings.externalHostId))
          .leftJoin(users, and(eq(users.id, listings.hostUserId), eq(listings.sourceId, "internal")))
          .where(inArray(listings.id, ids))
      : [],
    loadPhotos(ids, ids.length === 1 ? 8 : 3),
    loadWindows(ids, from),
  ]);

  const byId = new Map(rows.map((r) => [r.listing.id, r]));
  const shared: SharedListing[] = ids.flatMap((lid) => {
    const r = byId.get(lid);
    if (!r) return [];
    const x = r.listing;
    const host = r.internalHost ?? r.externalHost;
    return [
      {
        id: x.id,
        title: x.title,
        type: x.type,
        status: x.status,
        source: { id: x.sourceId, name: r.sourceName },
        url: x.externalUrl,
        location: locationLabel(x),
        photos: photos.get(x.id) ?? [],
        dates: (windows.get(x.id) ?? [])
          .filter((w) => !l.endDate || w.startDate <= l.endDate)
          .slice(0, 3)
          .map((w) => ({ start: w.startDate, end: w.endDate })),
        highlights: highlights(x.sourceId, x.attributes),
        summary: clip(x.description, ids.length === 1 ? 1500 : 260),
        maxGuests: x.maxGuests,
        rating: x.rating || null,
        host: host ? host.split(/\s+/)[0] : null, // first name only on a public page
      },
    ];
  });

  return {
    id: l.id,
    title: l.title,
    note: l.note,
    startDate: l.startDate,
    endDate: l.endDate,
    agent: link.agentName ? { name: link.agentName, kind: link.agentKind } : null,
    createdAt: l.createdAt,
    listings: shared,
  };
}
