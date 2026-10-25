import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { notify } from "@/lib/notify";

// Applying for stays. The agent drafts an application, the guest approves it with one click, and
// from then on everything that happens (sent, host replied, accepted, needs your login, no reply
// in 3 days, ...) is an event on the application's timeline plus a notification. Internal
// listings go straight to the host's inbox; external ones are submitted by the browser agent.

const { applications, applicationEvents: events, listings, listingPhotos, sources, users } = schema;

export type ApplicationStatus = (typeof schema.applicationStatus.enumValues)[number];
type Actor = (typeof schema.eventActor.enumValues)[number];
type EventKind = (typeof schema.applicationEventKind.enumValues)[number];

/** Still being worked on: the guest is waiting on us or on the host. */
export const IN_PROGRESS: ApplicationStatus[] = ["draft", "queued", "sending", "needs_user", "sent"];
/** The host said yes. */
export const CONFIRMED: ApplicationStatus[] = ["accepted", "scheduled"];
export const CLOSED: ApplicationStatus[] = ["declined", "cancelled", "failed"];

/** How long the host gets before the agent suggests a follow-up. */
const NO_REPLY_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export class ApplicationError extends Error {
  constructor(
    public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE" | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const summaryFields = {
  id: applications.id,
  userId: applications.userId,
  status: applications.status,
  statusMessage: applications.statusMessage,
  channel: applications.channel,
  startDate: applications.startDate,
  endDate: applications.endDate,
  intro: applications.intro,
  arrival: applications.arrival,
  liveViewUrl: applications.liveViewUrl,
  sentAt: applications.sentAt,
  updatedAt: applications.updatedAt,
  listing: {
    id: listings.id,
    title: listings.title,
    type: listings.type,
    city: listings.city,
    region: listings.region,
    externalUrl: listings.externalUrl,
    hostUserId: listings.hostUserId,
  },
  source: { id: sources.id, name: sources.name },
  guestName: sql<string>`(select ${users.name} from ${users} where ${users.id} = ${applications.userId})`,
  photo: sql<string | null>`(select ${listingPhotos.url} from ${listingPhotos} where ${listingPhotos.listingId} = ${listings.id} order by ${listingPhotos.position} limit 1)`,
  lastEvent: sql<string | null>`(select coalesce(${events.body}, '') from ${events} where ${events.applicationId} = ${applications.id} order by ${events.createdAt} desc limit 1)`,
};

function summaries() {
  return db
    .select(summaryFields)
    .from(applications)
    .innerJoin(listings, eq(listings.id, applications.listingId))
    .innerJoin(sources, eq(sources.id, listings.sourceId));
}

export type ApplicationSummary = Awaited<ReturnType<typeof listForGuest>>[number];

/** The guest's applications, newest activity first. */
export async function listForGuest(userId: string, statuses?: ApplicationStatus[]) {
  return summaries()
    .where(and(eq(applications.userId, userId), statuses ? inArray(applications.status, statuses) : undefined))
    .orderBy(desc(applications.updatedAt));
}

/** Applications to the host's own (internal) listings. Drafts are the guest's business only. */
export async function listForHost(hostUserId: string) {
  return summaries()
    .where(and(eq(listings.hostUserId, hostUserId), notInArray(applications.status, ["draft", "queued"])))
    .orderBy(desc(applications.updatedAt));
}

export async function getSummaries(ids: string[]) {
  if (!ids.length) return [];
  return summaries().where(inArray(applications.id, ids));
}

/** One application with its timeline, as seen by `viewerId` (the guest or the host). */
export async function getApplication(id: string, viewerId: string) {
  const [app] = await summaries().where(eq(applications.id, id));
  if (!app) throw new ApplicationError("NOT_FOUND", "No such application.");
  const role = app.userId === viewerId ? "guest" : app.listing.hostUserId === viewerId ? "host" : null;
  if (!role || (role === "host" && (app.status === "draft" || app.status === "queued")))
    throw new ApplicationError("NOT_FOUND", "No such application.");

  const [timeline, [guest], others] = await Promise.all([
    db.select().from(events).where(eq(events.applicationId, id)).orderBy(asc(events.createdAt)),
    db
      .select({ name: users.name, bio: users.bio, homeCity: users.homeCity, avatarUrl: users.avatarUrl, languages: users.languages })
      .from(users)
      .where(eq(users.id, app.userId)),
    role === "guest" ? overlapping(app) : Promise.resolve([]),
  ]);
  return { ...app, role, guest, timeline, overlapping: others } as const;
}

/** The guest's other live applications whose dates overlap this one's. */
async function overlapping(app: { id: string; userId: string; startDate: string | null; endDate: string | null }) {
  if (!app.startDate) return [];
  const end = app.endDate ?? app.startDate;
  return summaries().where(
    and(
      eq(applications.userId, app.userId),
      ne(applications.id, app.id),
      inArray(applications.status, [...IN_PROGRESS, ...CONFIRMED]),
      sql`${applications.startDate} <= ${end}`,
      sql`coalesce(${applications.endDate}, ${applications.startDate}) >= ${app.startDate}`,
    ),
  );
}

/** Unread notifications about applications (the Applications tab's badge; the bell counts all). */
export async function unreadCount(userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
        isNotNull(schema.notifications.applicationId),
      ),
    );
  return row?.n ?? 0;
}

export async function markRead(userId: string, applicationId?: string) {
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
        applicationId ? eq(schema.notifications.applicationId, applicationId) : undefined,
      ),
    );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type DraftInput = {
  listingId: string;
  startDate?: string;
  endDate?: string;
  /** What the host reads: who the guest is, why they're coming, dates. Written by the agent. */
  intro: string;
};

/**
 * Draft applications for the guest to approve. Re-drafting a listing they already have a live
 * application for updates that one instead of creating a second.
 */
export async function draftApplications(userId: string, drafts: DraftInput[]) {
  const ids = [...new Set(drafts.map((d) => d.listingId))];
  const found = await db
    .select({ id: listings.id, sourceId: listings.sourceId, hostUserId: listings.hostUserId, status: listings.status })
    .from(listings)
    .where(inArray(listings.id, ids));
  const byId = new Map(found.map((l) => [l.id, l]));

  const existing = await db
    .select({ id: applications.id, listingId: applications.listingId, status: applications.status })
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        inArray(applications.listingId, ids),
        inArray(applications.status, [...IN_PROGRESS, ...CONFIRMED]),
      ),
    );
  const live = new Map(existing.map((a) => [a.listingId, a]));

  const out: { listingId: string; applicationId?: string; error?: string }[] = [];
  for (const d of drafts) {
    const listing = byId.get(d.listingId);
    if (!listing || listing.status !== "active") {
      out.push({ listingId: d.listingId, error: "Listing not found or no longer active." });
      continue;
    }
    if (listing.hostUserId === userId) {
      out.push({ listingId: d.listingId, error: "That's your own listing." });
      continue;
    }
    const prior = live.get(d.listingId);
    if (prior && prior.status !== "draft") {
      out.push({ listingId: d.listingId, applicationId: prior.id, error: `Already applied (${prior.status}).` });
      continue;
    }
    const values = { startDate: d.startDate ?? null, endDate: d.endDate ?? d.startDate ?? null, intro: d.intro };
    if (prior) {
      await db.update(applications).set(values).where(eq(applications.id, prior.id));
      out.push({ listingId: d.listingId, applicationId: prior.id });
      continue;
    }
    const [row] = await db
      .insert(applications)
      .values({
        userId,
        listingId: d.listingId,
        channel: listing.sourceId === "internal" ? "internal" : "external_auto",
        status: "draft",
        statusMessage: "Ready to send. Review it and tap Send.",
        ...values,
      })
      .returning({ id: applications.id });
    await addEvent(row.id, "status", "agent", "Drafted your application.", { to: "draft" });
    out.push({ listingId: d.listingId, applicationId: row.id });
  }
  return out;
}

/** Load an application with what we need to move it along and tell the right people. */
async function load(id: string) {
  const [row] = await db
    .select({
      app: applications,
      listingTitle: listings.title,
      hostUserId: listings.hostUserId,
      sourceName: sources.name,
      guestName: users.name,
    })
    .from(applications)
    .innerJoin(listings, eq(listings.id, applications.listingId))
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(eq(applications.id, id));
  if (!row) throw new ApplicationError("NOT_FOUND", "No such application.");
  return row;
}

type Loaded = Awaited<ReturnType<typeof load>>;

function assertGuest(row: Loaded, userId: string) {
  if (row.app.userId !== userId) throw new ApplicationError("NOT_FOUND", "No such application.");
}

function assertHost(row: Loaded, userId: string) {
  if (!row.hostUserId || row.hostUserId !== userId) throw new ApplicationError("NOT_FOUND", "No such application.");
}

export async function addEvent(
  applicationId: string,
  kind: EventKind,
  actor: Actor,
  body: string | null,
  data: Record<string, unknown> = {},
) {
  const [row] = await db.insert(events).values({ applicationId, kind, actor, body, data }).returning();
  return row;
}

const path = (id: string) => `/applications/${id}`;

/** What the guest's card says after each status change, unless the change came with its own words. */
const DEFAULT_MESSAGE: Partial<Record<ApplicationStatus, string>> = {
  sent: "Waiting for the host to reply.",
  needs_user: "Open the live browser to continue.",
  accepted: "The host said yes! Confirm when you'll arrive.",
  declined: "The host can't take you this time. Want me to find similar places?",
  cancelled: "You withdrew this application.",
  failed: "Couldn't send it. Try again, or apply yourself.",
};

/**
 * Move an application to a new status, log it on the timeline and notify whoever should hear
 * about it. Every status change goes through here.
 */
export async function setStatus(
  id: string,
  to: ApplicationStatus,
  opts: {
    actor: Actor;
    /** Shown on the card and the timeline. */
    message?: string;
    patch?: Partial<typeof applications.$inferInsert>;
    /** Skip notifications, e.g. for steps the guest just did themself. */
    quiet?: boolean;
    /** Extra data on the status event, e.g. what a needs_user step is waiting for (`ask`). Never secrets. */
    data?: Record<string, unknown>;
  },
) {
  const row = await load(id);
  const from = row.app.status;
  const now = new Date();
  const message = opts.message ?? DEFAULT_MESSAGE[to] ?? null;
  await db
    .update(applications)
    .set({
      status: to,
      statusMessage: message,
      ...(to === "sent" && !row.app.sentAt && { sentAt: now }),
      ...(opts.actor === "host" && { hostActivityAt: now }),
      ...opts.patch,
    })
    .where(eq(applications.id, id));
  await addEvent(id, "status", opts.actor, message, { ...opts.data, from, to });
  if (row.app.channel === "internal") await mirrorToHostInbox(id, to, opts.actor);

  // Still waiting on the guest (the run timed out mid-ask): they already heard. One push per real change.
  if (opts.quiet || (from === "needs_user" && to === "needs_user")) return;
  const where = row.listingTitle;
  const guest = (title: string, body?: string) =>
    notify(row.app.userId, { title, body, url: path(id), applicationId: id });
  const host = (title: string, body?: string) =>
    row.hostUserId ? notify(row.hostUserId, { title, body, url: path(id), applicationId: id }) : undefined;

  switch (to) {
    case "sent":
      await guest(`Sent: ${where}`, `Your application is with the host on ${row.sourceName}. I'll tell you as soon as they reply.`);
      if (row.app.channel === "internal" && row.hostUserId)
        await notify(row.hostUserId, {
          title: `${row.guestName} wants to stay at your place`,
          body: row.app.intro ?? undefined,
          url: "/requests",
          applicationId: id,
        });
      break;
    case "needs_user": {
      // What the agent is waiting for: a login or email for the Keychain, else something in the browser.
      const ask = opts.data?.ask as { kind?: string; siteName?: string } | undefined;
      const site = ask?.siteName ?? row.sourceName;
      const title =
        ask?.kind === "credentials"
          ? `Your ${site} login, please: ${where}`
          : ask?.kind === "email"
            ? `Your email, please: ${where}`
            : `I need you for a moment: ${where}`;
      await guest(title, message ?? undefined);
      break;
    }
    case "accepted": {
      const others = await overlapping({ ...row.app });
      await guest(`Accepted! ${where}`, message ?? undefined);
      if (others.length)
        await addEvent(
          id,
          "nudge",
          "agent",
          `You have ${others.length} other application${others.length === 1 ? "" : "s"} for overlapping dates. Withdraw ${others.length === 1 ? "it" : "them"}?`,
          { kind: "overlap", applicationIds: others.map((o) => o.id) },
        );
      break;
    }
    case "declined":
      await guest(`Not this time: ${where}`, message ?? undefined);
      break;
    case "scheduled":
      // Tell whoever didn't set it.
      if (opts.actor !== "guest") await guest(`Stay scheduled: ${where}`, message ?? undefined);
      if (opts.actor !== "host") await host(`Stay scheduled with ${row.guestName}`, message ?? undefined);
      break;
    case "cancelled":
      if (CONFIRMED.includes(from) || from === "sent")
        await host(`${row.guestName} withdrew their request`, `For ${where}.`);
      break;
    case "failed":
      await guest(`Couldn't send: ${where}`, message ?? undefined);
      break;
  }
}

/**
 * Keep the host's inbox row (incoming_requests, created when they open /requests) in step with
 * the application, whichever side moved it.
 */
async function mirrorToHostInbox(id: string, to: ApplicationStatus, actor: Actor) {
  const status = { accepted: "accepted", scheduled: "accepted", declined: "declined", cancelled: "withdrawn" } as const;
  const mirrored = status[to as keyof typeof status];
  if (!mirrored) return;
  await db
    .update(schema.incomingRequests)
    .set({ status: mirrored, ...(actor === "host" && { respondedAt: new Date() }) })
    .where(eq(schema.incomingRequests.applicationId, id));
}

/** The guest approved these drafts: send internal ones now, queue external ones for the browser agent. */
export async function approve(userId: string, ids: string[]) {
  const sent: string[] = [];
  const queued: string[] = [];
  for (const id of ids) {
    const row = await load(id);
    assertGuest(row, userId);
    if (row.app.status !== "draft" && row.app.status !== "failed")
      throw new ApplicationError("INVALID_STATE", `Already ${row.app.status}.`);
    if (row.app.channel === "internal") {
      await setStatus(id, "sent", { actor: "guest", message: "Sent to the host." });
      sent.push(id);
    } else {
      await setStatus(id, "queued", {
        actor: "guest",
        message: `Starting a browser to apply on ${row.sourceName}…`,
        patch: { error: null },
        quiet: true,
      });
      queued.push(id);
    }
  }
  return { sent, queued };
}

/** The guest applied on the external site themself (after the agent couldn't, or by choice). */
export async function markSentManually(userId: string, id: string) {
  const row = await load(id);
  assertGuest(row, userId);
  if (!["draft", "failed", "needs_user", "queued"].includes(row.app.status))
    throw new ApplicationError("INVALID_STATE", `Already ${row.app.status}.`);
  await setStatus(id, "sent", {
    actor: "guest",
    message: `You applied on ${row.sourceName} yourself.`,
    patch: { channel: "external_manual", nextCheckAt: null },
    quiet: true,
  });
}

export async function withdraw(userId: string, id: string) {
  const row = await load(id);
  assertGuest(row, userId);
  if (CLOSED.includes(row.app.status)) return;
  await setStatus(id, "cancelled", { actor: "guest", message: "You withdrew this application.", quiet: row.app.status === "draft" });
}

/** A message on the application's thread. Internal: goes to the other side. External: the guest's own note or a reply we relayed. */
export async function postMessage(userId: string, id: string, body: string) {
  const text = body.trim();
  if (!text) throw new ApplicationError("INVALID_INPUT", "Message is empty.");
  const row = await load(id);
  const isGuest = row.app.userId === userId;
  const isHost = !!row.hostUserId && row.hostUserId === userId;
  if (!isGuest && !isHost) throw new ApplicationError("NOT_FOUND", "No such application.");
  if (row.app.status === "draft") throw new ApplicationError("INVALID_STATE", "Send the application first.");

  const actor: Actor = isGuest ? "guest" : "host";
  const event = await addEvent(id, "message", actor, text, {
    // External replies go out through the browser agent, which marks them delivered.
    ...(row.app.channel !== "internal" && isGuest && { delivery: "pending" }),
  });
  if (isHost) await db.update(applications).set({ hostActivityAt: new Date() }).where(eq(applications.id, id));
  else await db.update(applications).set({ updatedAt: new Date() }).where(eq(applications.id, id));

  if (row.app.channel === "internal") {
    const to = isGuest ? row.hostUserId! : row.app.userId;
    const title = isGuest ? `New message from ${row.guestName}` : `The host replied: ${row.listingTitle}`;
    await notify(to, { title, body: text, url: path(id), applicationId: id });
  }
  return event;
}

/** A host's reply that the watcher found on an external site. */
export async function recordHostMessage(id: string, body: string, data: Record<string, unknown> = {}) {
  const row = await load(id);
  await addEvent(id, "message", "host", body, data);
  await db.update(applications).set({ hostActivityAt: new Date() }).where(eq(applications.id, id));
  await notify(row.app.userId, {
    title: `The host replied: ${row.listingTitle}`,
    body,
    url: path(id),
    applicationId: id,
  });
}

/** Host's decision on a request to their internal listing. */
export async function respond(hostUserId: string, id: string, decision: "accept" | "decline", message?: string) {
  const row = await load(id);
  assertHost(row, hostUserId);
  if (row.app.status !== "sent") throw new ApplicationError("INVALID_STATE", `Already ${row.app.status}.`);
  if (message?.trim()) await postMessage(hostUserId, id, message);
  await setStatus(id, decision === "accept" ? "accepted" : "declined", {
    actor: "host",
    message: message?.trim() || undefined,
  });
}

/** Guest or host confirms dates and arrival. */
export async function schedule(
  userId: string,
  id: string,
  input: { startDate?: string; endDate?: string; arrival: string },
) {
  const row = await load(id);
  const isGuest = row.app.userId === userId;
  if (!isGuest) assertHost(row, userId);
  if (row.app.status !== "accepted" && row.app.status !== "scheduled")
    throw new ApplicationError("INVALID_STATE", "The host has to accept first.");
  const startDate = input.startDate ?? row.app.startDate;
  const endDate = input.endDate ?? row.app.endDate ?? startDate;
  await setStatus(id, "scheduled", {
    actor: isGuest ? "guest" : "host",
    message: `Arriving ${input.arrival}.`,
    patch: { startDate, endDate, arrival: input.arrival },
  });
}

// ---------------------------------------------------------------------------
// Follow-ups (run by the cron job)
// ---------------------------------------------------------------------------

/** Sent applications the host hasn't touched in 3 days get one "follow up?" nudge each. */
export async function nudgeQuietApplications(now = new Date()) {
  const cutoff = new Date(now.getTime() - NO_REPLY_AFTER_MS);
  const quiet = await db
    .select({ id: applications.id, userId: applications.userId, title: listings.title })
    .from(applications)
    .innerJoin(listings, eq(listings.id, applications.listingId))
    .where(
      and(
        eq(applications.status, "sent"),
        lt(applications.sentAt, cutoff),
        or(isNull(applications.hostActivityAt), lt(applications.hostActivityAt, cutoff)),
        sql`not exists (select 1 from ${events} where ${events.applicationId} = ${applications.id} and ${events.kind} = 'nudge' and ${events.data}->>'kind' = 'no_reply' and ${events.createdAt} > ${cutoff})`,
      ),
    )
    .limit(100);

  for (const a of quiet) {
    await addEvent(a.id, "nudge", "agent", "No reply in 3 days. Want me to follow up, or apply to a few similar places?", {
      kind: "no_reply",
    });
    await notify(a.userId, {
      title: `No reply yet: ${a.title}`,
      body: "Hosts often reply within a few days. Want me to follow up, or apply to a few similar places?",
      url: path(a.id),
      applicationId: a.id,
    });
  }
  return quiet.length;
}
