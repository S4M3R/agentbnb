import { z } from "zod";
import { getSummaries, unreadCount } from "@/lib/applications";
import { webSession } from "@/lib/session";

// Live status for the application cards in the chat, plus the unread badge.
// GET /api/applications?ids=<uuid>,<uuid>
export async function GET(req: Request) {
  const user = await (await webSession()).user();
  if (!user) return Response.json({ unread: 0, applications: [] });

  const raw = new URL(req.url).searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  const ids = z.array(z.uuid()).max(20).safeParse(raw);
  if (!ids.success) return Response.json({ error: { code: "INVALID_IDS", message: "ids must be UUIDs" } }, { status: 400 });

  const [unread, rows] = await Promise.all([unreadCount(user.id), getSummaries(ids.data)]);
  return Response.json({
    unread,
    applications: rows
      .filter((a) => a.userId === user.id)
      .map((a) => ({ id: a.id, status: a.status, statusMessage: a.statusMessage })),
  });
}
