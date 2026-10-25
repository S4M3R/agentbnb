"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import * as apps from "@/lib/applications";
import { webSession } from "@/lib/session";

// Everything the guest or host does from a button: in chat cards and on /applications.
// These only change state. Work on external sites happens in browser runs, which the client
// starts right after with POST /api/applications/run (see useRunApplications).

type Result = { ok: true } | { ok: false; error: string };

async function viewer() {
  const user = await (await webSession()).user();
  if (!user) throw new apps.ApplicationError("NOT_FOUND", "No such application.");
  return user;
}

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof apps.ApplicationError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

const id = z.uuid();

/** One click to send. Internal ones reach the host right away; external ones are queued for the browser agent. */
export async function sendApplications(ids: string[]) {
  return run(async () => {
    const user = await viewer();
    await apps.approve(user.id, z.array(id).min(1).max(20).parse(ids));
  });
}

export async function withdrawApplications(ids: string[]) {
  return run(async () => {
    const user = await viewer();
    for (const a of z.array(id).max(20).parse(ids)) await apps.withdraw(user.id, a);
  });
}

export async function markSentManually(applicationId: string) {
  return run(async () => apps.markSentManually((await viewer()).id, id.parse(applicationId)));
}

export async function postMessage(applicationId: string, body: string) {
  return run(async () => {
    const user = await viewer();
    await apps.postMessage(user.id, id.parse(applicationId), z.string().max(4000).parse(body));
  });
}

export async function respondToRequest(applicationId: string, decision: "accept" | "decline", message?: string) {
  return run(async () =>
    apps.respond((await viewer()).id, id.parse(applicationId), z.enum(["accept", "decline"]).parse(decision), message),
  );
}

export async function scheduleStay(applicationId: string, arrival: string) {
  return run(async () =>
    apps.schedule((await viewer()).id, id.parse(applicationId), { arrival: z.string().trim().min(1).max(200).parse(arrival) }),
  );
}

/** The guest finished logging in / answering in the live browser; hand control back to the agent. */
export async function continueInBrowser(applicationId: string) {
  return run(async () => {
    const user = await viewer();
    const a = id.parse(applicationId);
    const [row] = await db
      .select({ userId: schema.applications.userId, status: schema.applications.status })
      .from(schema.applications)
      .where(eq(schema.applications.id, a));
    if (row?.userId !== user.id) throw new apps.ApplicationError("NOT_FOUND", "No such application.");
    if (row.status !== "needs_user") throw new apps.ApplicationError("INVALID_STATE", "Nothing to continue.");
    await db
      .update(schema.applications)
      .set({ userActedAt: new Date(), status: "sending", statusMessage: "Thanks! Picking it up from here…" })
      .where(eq(schema.applications.id, a));
  });
}

export async function markNotificationsRead(applicationId?: string) {
  const user = await (await webSession()).user();
  if (user) await apps.markRead(user.id, applicationId ? id.parse(applicationId) : undefined);
}

export async function saveEmail(email: string): Promise<Result> {
  const parsed = z.email().safeParse(email.trim().toLowerCase());
  if (!parsed.success) return { ok: false, error: "That doesn't look like an email address." };
  const user = await (await webSession()).ensureUser();
  try {
    await db.update(schema.users).set({ email: parsed.data }).where(eq(schema.users.id, user.id));
  } catch {
    return { ok: false, error: "That email is already used by another account." };
  }
  refresh();
  return { ok: true };
}
