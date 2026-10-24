import { and, asc, desc, eq, gt, or } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { agentModel } from "@/lib/agent/model";
import { ApiError } from "@/lib/api-auth";
import { checkExpiry } from "@/lib/requests";
import { logEvent, runCheck } from "./agent";

const { backgroundChecks: checks, backgroundCheckFindings: findings, backgroundCheckEvents: events } = schema;
const { incomingRequests: requests, sources } = schema;

/** A running check older than this died with its function; it's shown as failed. */
const STALE_MS = 6 * 60 * 1000;

/**
 * Start a background check on one of the host's requests and run it after the response is sent.
 * Returns the running check if there already is one. Call from a route with a long `maxDuration`.
 */
export async function startCheck(hostUserId: string, requestId: string) {
  if (!z.uuid().safeParse(requestId).success) throw notFound();
  const [request] = await db
    .select({ id: requests.id, status: requests.status, endDate: requests.endDate, guestUserId: requests.guestUserId })
    .from(requests)
    .where(and(eq(requests.id, requestId), eq(requests.hostUserId, hostUserId)));
  if (!request) throw notFound();

  const [running] = await db
    .select({ id: checks.id, startedAt: checks.startedAt })
    .from(checks)
    .where(and(eq(checks.requestId, requestId), eq(checks.status, "running")));
  if (running && Date.now() - running.startedAt.getTime() < STALE_MS) return { id: running.id, started: false };

  const [check] = await db
    .insert(checks)
    .values({
      requestId,
      requestedBy: hostUserId,
      guestUserId: request.guestUserId,
      model: typeof agentModel === "string" ? agentModel : agentModel.modelId,
      expiresAt: checkExpiry(request),
    })
    .returning({ id: checks.id });
  await logEvent(check.id, "note", "Starting the check");
  after(() => runCheck(check.id));
  return { id: check.id, started: true };
}

function notFound() {
  return new ApiError(404, "REQUEST_NOT_FOUND", "No request with that id.");
}

export type CheckState = NonNullable<Awaited<ReturnType<typeof getCheck>>>;

/**
 * A check with its findings and live events, for the host who asked for it or the guest it's about.
 * Pass `afterEvent` to get only the events since the last poll.
 */
export async function getCheck(viewerUserId: string, checkId: string, afterEvent = 0) {
  if (!z.uuid().safeParse(checkId).success) return null;
  const [row] = await db
    .select({
      id: checks.id,
      requestId: checks.requestId,
      status: checks.status,
      verdict: checks.verdict,
      summary: checks.summary,
      profile: checks.profile,
      questions: checks.questions,
      unverified: checks.unverified,
      error: checks.error,
      steps: checks.steps,
      startedAt: checks.startedAt,
      finishedAt: checks.finishedAt,
      expiresAt: checks.expiresAt,
      requestedBy: checks.requestedBy,
      guestUserId: checks.guestUserId,
      guest: requests.guest,
      source: { id: sources.id, name: sources.name },
    })
    .from(checks)
    .innerJoin(requests, eq(requests.id, checks.requestId))
    .innerJoin(sources, eq(sources.id, requests.sourceId))
    .where(and(eq(checks.id, checkId), or(eq(checks.requestedBy, viewerUserId), eq(checks.guestUserId, viewerUserId))));
  if (!row) return null;

  if (row.status === "running" && Date.now() - row.startedAt.getTime() > STALE_MS) {
    const message = "The check stopped before finishing. Run it again.";
    await db.update(checks).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(checks.id, row.id));
    Object.assign(row, { status: "failed", error: message });
  }

  const [found, log] = await Promise.all([
    db
      .select({
        id: findings.id,
        category: findings.category,
        title: findings.title,
        detail: findings.detail,
        sourceUrl: findings.sourceUrl,
        sourceTitle: findings.sourceTitle,
        confidence: findings.confidence,
        createdAt: findings.createdAt,
      })
      .from(findings)
      .where(eq(findings.checkId, row.id))
      .orderBy(asc(findings.createdAt)),
    db
      .select({ id: events.id, kind: events.kind, message: events.message, url: events.url, createdAt: events.createdAt })
      .from(events)
      .where(and(eq(events.checkId, row.id), gt(events.id, afterEvent)))
      .orderBy(asc(events.id))
      .limit(200),
  ]);

  const { requestedBy, guestUserId, ...check } = row;
  return {
    ...check,
    viewer: requestedBy === viewerUserId ? ("host" as const) : ("guest" as const),
    guestIsMember: guestUserId != null,
    findings: found,
    events: log,
  };
}

/** The latest check on a request, for the host's request page. */
export async function latestCheckId(hostUserId: string, requestId: string) {
  const [row] = await db
    .select({ id: checks.id })
    .from(checks)
    .where(and(eq(checks.requestId, requestId), eq(checks.requestedBy, hostUserId)))
    .orderBy(desc(checks.startedAt))
    .limit(1);
  return row?.id ?? null;
}

/** Checks hosts ran on this person, so they can see what hosts saw. */
export async function checksAboutMe(userId: string) {
  return db
    .select({ id: checks.id, startedAt: checks.startedAt, status: checks.status, verdict: checks.verdict })
    .from(checks)
    .where(eq(checks.guestUserId, userId))
    .orderBy(desc(checks.startedAt));
}
