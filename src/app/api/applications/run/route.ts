import { and, eq, inArray } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { runApplication } from "@/lib/apply-agent";
import { webSession } from "@/lib/session";

// Start browser runs for external applications: submit, send pending replies, check for news.
// Called by the guest's browser right after they act (or while it shows a queued application),
// and by the cron with CRON_SECRET for unattended checks. Safe to call repeatedly: a run that's
// already going keeps the application, and a run with nothing to do ends right away.

export const maxDuration = 300;

const Body = z.object({ ids: z.array(z.uuid()).min(1).max(10), force: z.boolean().optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID_BODY", message: z.prettifyError(parsed.error) } }, { status: 400 });
  }
  const { ids, force } = parsed.data;

  const fromCron = !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  let owned = ids;
  if (!fromCron) {
    const user = await (await webSession()).user();
    if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "No session." } }, { status: 401 });
    const rows = await db
      .select({ id: schema.applications.id })
      .from(schema.applications)
      .where(and(inArray(schema.applications.id, ids), eq(schema.applications.userId, user.id)));
    owned = rows.map((r) => r.id);
  }

  after(() => Promise.all(owned.map((id) => runApplication(id, { interactive: !fromCron, force }))));
  return Response.json({ started: owned.length });
}
