import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { latestAsk } from "@/lib/access";
import { getSummaries, unreadCount } from "@/lib/applications";
import { webSession } from "@/lib/session";

// Live status for the application cards in the chat, plus the unread badge. A waiting (needs_user)
// application also says what it's waiting for (`ask`: a login, an email), so its card can show the form.
// GET /api/applications?ids=<uuid>,<uuid>
export async function GET(req: Request) {
  const user = await (await webSession()).user();
  if (!user) return Response.json({ unread: 0, applications: [] });

  const raw = new URL(req.url).searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  const ids = z.array(z.uuid()).max(20).safeParse(raw);
  if (!ids.success) return Response.json({ error: { code: "INVALID_IDS", message: "ids must be UUIDs" } }, { status: 400 });

  const [unread, rows] = await Promise.all([unreadCount(user.id), getSummaries(ids.data)]);
  const mine = rows.filter((a) => a.userId === user.id);
  const waiting = mine.filter((a) => a.status === "needs_user").map((a) => a.id);
  const timeline = waiting.length
    ? await db
        .select({ applicationId: schema.applicationEvents.applicationId, kind: schema.applicationEvents.kind, data: schema.applicationEvents.data })
        .from(schema.applicationEvents)
        .where(and(inArray(schema.applicationEvents.applicationId, waiting), eq(schema.applicationEvents.kind, "status")))
        .orderBy(schema.applicationEvents.createdAt)
    : [];
  return Response.json({
    unread,
    applications: mine.map((a) => ({
      id: a.id,
      status: a.status,
      statusMessage: a.statusMessage,
      ask: latestAsk(a.status, timeline.filter((e) => e.applicationId === a.id)),
    })),
  });
}
