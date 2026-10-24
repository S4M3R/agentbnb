import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, authenticate } from "@/lib/api-auth";
import { setStatus } from "@/lib/applications";
import { currentUser } from "@/lib/session";

// Stay requests a host receives, from AgentBnB and from the external networks their place is on.
// Internal ones are mirrored from `applications`; external ones are imported from the host's
// inbox on each platform (by their agent through /api/v1, or by the browser agent's watcher).

const { incomingRequests: requests, backgroundChecks: checks, listings, sources } = schema;

export { currentUser };

export type RequestStatus = (typeof schema.requestStatus.enumValues)[number];

const DAY = 24 * 60 * 60 * 1000;
/** Checks on requests nobody has answered yet are deleted after this long. */
export const UNDECIDED_RETENTION_DAYS = 90;
/** Checks are deleted this long after the host decides or the stay ends, whichever is later. */
export const DECIDED_RETENTION_DAYS = 30;

/** When a check about this request should be deleted. */
export function checkExpiry(request: { status: RequestStatus; endDate: string | null }, now = new Date()) {
  if (request.status === "new" || request.status === "replied") {
    return new Date(now.getTime() + UNDECIDED_RETENTION_DAYS * DAY);
  }
  const end = request.endDate ? new Date(`${request.endDate}T23:59:59Z`) : now;
  return new Date(Math.max(now.getTime(), end.getTime()) + DECIDED_RETENTION_DAYS * DAY);
}

/** Copy internal applications on this host's listings into their inbox. Idempotent. */
async function syncInternal(hostUserId: string) {
  await db.execute(sql`
    insert into incoming_requests
      (host_user_id, listing_id, source_id, application_id, guest_user_id, guest, message, start_date, end_date, status, received_at)
    select l.host_user_id, l.id, 'internal', a.id, u.id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', u.name, 'photoUrl', u.avatar_url, 'location', u.home_city, 'about', u.bio,
        'languages', to_jsonb(u.languages), 'verified', u.verified, 'memberSince', u.created_at::date
      )),
      a.intro, a.start_date, a.end_date,
      (case a.status::text
        when 'accepted' then 'accepted' when 'scheduled' then 'accepted'
        when 'declined' then 'declined' when 'cancelled' then 'withdrawn'
        else 'new' end)::request_status,
      a.created_at
    from applications a
    join listings l on l.id = a.listing_id
    join users u on u.id = a.user_id
    where l.host_user_id = ${hostUserId}
      and a.channel = 'internal'
      and a.status::text in ('sent', 'accepted', 'declined', 'scheduled', 'cancelled')
    on conflict (application_id) do nothing`);
}

/** Delete checks past their retention date. Cheap enough to run whenever a host opens the inbox. */
export async function purgeExpiredChecks() {
  await db.delete(checks).where(lt(checks.expiresAt, new Date()));
}

const latestCheck = sql<{
  id: string;
  status: (typeof schema.backgroundCheckStatus.enumValues)[number];
  verdict: (typeof schema.backgroundCheckVerdict.enumValues)[number] | null;
  summary: string | null;
} | null>`(
  select json_build_object('id', c.id, 'status', c.status, 'verdict', c.verdict, 'summary', c.summary)
  from background_checks c where c.request_id = ${requests.id}
  order by c.started_at desc limit 1
)`;

const requestColumns = {
  id: requests.id,
  applicationId: requests.applicationId,
  status: requests.status,
  guest: requests.guest,
  guestIsMember: sql<boolean>`${requests.guestUserId} is not null`,
  /** The guest's AgentBnB member id (public profile at /people/[id]), or null for external guests. */
  guestUserId: requests.guestUserId,
  message: requests.message,
  startDate: requests.startDate,
  endDate: requests.endDate,
  guestCount: requests.guestCount,
  externalUrl: requests.externalUrl,
  receivedAt: requests.receivedAt,
  respondedAt: requests.respondedAt,
  source: { id: sources.id, name: sources.name },
  listing: { id: listings.id, title: listings.title, city: listings.city },
  check: latestCheck,
};

export type HostRequest = Awaited<ReturnType<typeof listRequests>>[number];

export async function listRequests(hostUserId: string, opts: { status?: RequestStatus[] } = {}) {
  await Promise.all([syncInternal(hostUserId), purgeExpiredChecks()]);
  return db
    .select(requestColumns)
    .from(requests)
    .innerJoin(sources, eq(sources.id, requests.sourceId))
    .leftJoin(listings, eq(listings.id, requests.listingId))
    .where(
      and(eq(requests.hostUserId, hostUserId), opts.status?.length ? inArray(requests.status, opts.status) : undefined),
    )
    .orderBy(sql`${requests.status} in ('new', 'replied') desc`, desc(requests.receivedAt));
}

export async function getRequest(hostUserId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select(requestColumns)
    .from(requests)
    .innerJoin(sources, eq(sources.id, requests.sourceId))
    .leftJoin(listings, eq(listings.id, requests.listingId))
    .where(and(eq(requests.id, id), eq(requests.hostUserId, hostUserId)));
  return row ?? null;
}

export const Decision = z.object({ decision: z.enum(["accept", "decline"]) });

/**
 * Accept or decline. Internal requests update the guest's application too; external ones still
 * have to be answered on the platform (the response includes the link) until the browser agent does it.
 */
export async function respondToRequest(hostUserId: string, id: string, decision: "accept" | "decline") {
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "REQUEST_NOT_FOUND", "No open request with that id.");
  const status = decision === "accept" ? "accepted" : "declined";
  const [row] = await db
    .update(requests)
    .set({ status, respondedAt: new Date() })
    .where(and(eq(requests.id, id), eq(requests.hostUserId, hostUserId), ne(requests.status, "withdrawn")))
    .returning({
      id: requests.id,
      status: requests.status,
      endDate: requests.endDate,
      applicationId: requests.applicationId,
      externalUrl: requests.externalUrl,
    });
  if (!row) throw new ApiError(404, "REQUEST_NOT_FOUND", "No open request with that id.");

  await Promise.all([
    // The guest's application follows (and they're notified) unless it already moved on.
    row.applicationId && answerApplication(row.applicationId, status),
    db.update(checks).set({ expiresAt: checkExpiry(row) }).where(eq(checks.requestId, row.id)),
  ]);
  return {
    id: row.id,
    status: row.status,
    answerOnPlatform: row.applicationId ? null : row.externalUrl,
  };
}

async function answerApplication(applicationId: string, status: "accepted" | "declined") {
  const [app] = await db
    .select({ status: schema.applications.status })
    .from(schema.applications)
    .where(eq(schema.applications.id, applicationId));
  if (app?.status === "sent") await setStatus(applicationId, status, { actor: "host" });
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const httpUrl = z.url({ protocol: /^https?$/ });

export const ImportedRequest = z.object({
  /** Platform the request came in on, e.g. "couchsurfing". Not "internal". */
  source: z.string().min(1),
  /** The request's id on the platform, so importing it again updates it instead of duplicating. */
  externalRef: z.string().min(1).max(200),
  externalUrl: httpUrl.optional(),
  listingId: z.uuid().optional(),
  guest: z.object({
    name: z.string().trim().min(1).max(120),
    profileUrl: httpUrl.optional(),
    photoUrl: httpUrl.optional(),
    username: z.string().max(120).optional(),
    location: z.string().max(200).optional(),
    age: z.number().int().min(16).max(120).optional(),
    memberSince: z.string().max(40).optional(),
    references: z.number().int().min(0).optional(),
    verified: z.boolean().optional(),
    languages: z.array(z.string().max(40)).max(20).optional(),
    about: z.string().max(4000).optional(),
  }),
  message: z.string().max(8000).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  guestCount: z.number().int().min(1).max(50).optional(),
  receivedAt: z.iso.datetime({ offset: true }).optional(),
});

/** Add or update a request the host received on an external platform. */
export async function importRequest(hostUserId: string, input: z.infer<typeof ImportedRequest>) {
  if (input.source === "internal") {
    throw new ApiError(400, "INVALID_SOURCE", "Internal requests come from applications; import external ones only.");
  }
  const [source] = await db.select({ id: sources.id }).from(sources).where(eq(sources.id, input.source));
  if (!source) throw new ApiError(400, "UNKNOWN_SOURCE", `No source "${input.source}". Source ids are listed in /docs.md.`);
  if (input.listingId) {
    const [own] = await db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.id, input.listingId), eq(listings.hostUserId, hostUserId)));
    if (!own) throw new ApiError(400, "UNKNOWN_LISTING", "listingId must be one of your own listings.");
  }

  const values = {
    hostUserId,
    sourceId: input.source,
    externalRef: input.externalRef,
    externalUrl: input.externalUrl ?? null,
    listingId: input.listingId ?? null,
    guest: input.guest,
    message: input.message ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    guestCount: input.guestCount ?? null,
    ...(input.receivedAt && { receivedAt: new Date(input.receivedAt) }),
  };
  const [row] = await db
    .insert(requests)
    .values(values)
    .onConflictDoUpdate({
      target: [requests.hostUserId, requests.sourceId, requests.externalRef],
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: requests.id, status: requests.status });
  return row;
}

/** The person behind a request: a bearer API key (their agents) or the web session cookie (the site). */
export async function requestUser(req: Request) {
  const principal = await authenticate(req);
  if (principal) return principal.user;
  return currentUser();
}
