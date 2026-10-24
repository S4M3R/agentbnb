import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONFIRMED, listForGuest, listForHost } from "@/lib/applications";
import { addDays, buildCalendar, type CalendarInput, type HostedGuest, type TripStay } from "@/components/calendar/calendar";

// The member's calendar: their own places (open and blocked nights, guests booked or asking, from
// AgentBnB and every network) and the places they're staying. The shaping lives in
// components/calendar/calendar.ts; this file only gathers the rows.

const { listings, listingPhotos, listingAvailability, incomingRequests, sources } = schema;

/** Waiting on the host. Drafts and failed sends don't hold any nights. */
const WAITING = ["queued", "sending", "needs_user", "sent"] as const;

/** Today in Pacific time, like the agent's sense of "today". */
export function calendarToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

export async function getCalendar(userId: string) {
  return buildCalendar(await calendarInput(userId));
}

export async function calendarInput(userId: string): Promise<CalendarInput> {
  const own = await db
    .select({ id: listings.id, title: listings.title })
    .from(listings)
    .where(
      and(
        eq(listings.hostUserId, userId),
        eq(listings.sourceId, "internal"),
        inArray(listings.status, ["draft", "active", "paused"]),
      ),
    )
    .orderBy(asc(listings.createdAt));
  const ids = own.map((l) => l.id);

  const [photos, ranges, hosted, external, mine] = await Promise.all([
    ids.length
      ? db
          .select({ listingId: listingPhotos.listingId, url: listingPhotos.url, position: listingPhotos.position })
          .from(listingPhotos)
          .where(inArray(listingPhotos.listingId, ids))
          .orderBy(asc(listingPhotos.position))
      : [],
    ids.length
      ? db
          .select({
            listingId: listingAvailability.listingId,
            start: listingAvailability.startDate,
            end: listingAvailability.endDate,
            kind: listingAvailability.kind,
          })
          .from(listingAvailability)
          .where(inArray(listingAvailability.listingId, ids))
      : [],
    listForHost(userId),
    // Requests from other networks; AgentBnB's own come straight from applications (always current).
    db
      .select({
        id: incomingRequests.id,
        listingId: incomingRequests.listingId,
        guest: incomingRequests.guest,
        startDate: incomingRequests.startDate,
        endDate: incomingRequests.endDate,
        status: incomingRequests.status,
        source: sources.name,
      })
      .from(incomingRequests)
      .innerJoin(sources, eq(sources.id, incomingRequests.sourceId))
      .where(
        and(
          eq(incomingRequests.hostUserId, userId),
          ne(incomingRequests.sourceId, "internal"),
          isNotNull(incomingRequests.startDate),
          inArray(incomingRequests.status, ["new", "replied", "accepted"]),
        ),
      ),
    listForGuest(userId, [...CONFIRMED, ...WAITING]),
  ]);

  const places = own.map((l) => ({
    id: l.id,
    title: l.title,
    photo: photos.find((p) => p.listingId === l.id)?.url ?? null,
    open: ranges.filter((r) => r.listingId === l.id && r.kind === "available"),
    blocked: ranges.filter((r) => r.listingId === l.id && r.kind === "blocked"),
  }));

  // A stay without an end date is one night.
  const endOf = (start: string, end: string | null) => (end && end > start ? end : addDays(start, 1));

  const guests: HostedGuest[] = [
    ...hosted.flatMap((a) =>
      a.startDate && (CONFIRMED.includes(a.status) || a.status === "sent")
        ? [
            {
              id: a.id,
              placeId: a.listing.id,
              name: a.guestName,
              start: a.startDate,
              end: endOf(a.startDate, a.endDate),
              status: CONFIRMED.includes(a.status) ? ("booked" as const) : ("request" as const),
              source: a.source.name,
              href: `/applications/${a.id}`,
            },
          ]
        : [],
    ),
    ...external.map((r) => ({
      id: r.id,
      placeId: r.listingId,
      name: r.guest.name,
      photo: r.guest.photoUrl ?? null,
      start: r.startDate!,
      end: endOf(r.startDate!, r.endDate),
      status: r.status === "accepted" ? ("booked" as const) : ("request" as const),
      source: r.source,
      href: `/requests/${r.id}`,
    })),
  ];

  const stays: TripStay[] = mine.flatMap((a) =>
    a.startDate
      ? [
          {
            id: a.id,
            title: a.listing.title,
            where: a.listing.city,
            photo: a.photo,
            start: a.startDate,
            end: endOf(a.startDate, a.endDate),
            status: CONFIRMED.includes(a.status) ? ("confirmed" as const) : ("pending" as const),
            source: a.source.name,
            href: `/applications/${a.id}`,
          },
        ]
      : [],
  );

  return { today: calendarToday(), places, guests, stays };
}
