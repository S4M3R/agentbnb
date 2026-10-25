import { z } from "zod";
import { apiError, errorResponse, parseBody } from "@/lib/api-auth";
import { countUnread, markNotificationsRead } from "@/lib/notify";
import { currentUser } from "@/lib/session";

const Body = z.object({ ids: z.array(z.uuid()).min(1).max(100).optional() });

// Mark notifications read: the given ids, or all of them when `ids` is left out. Called by the
// bell and by the service worker when a push is clicked. Returns the new unread count.
// POST /api/notifications/read { ids?: string[] }
export async function POST(req: Request) {
  try {
    const { ids } = await parseBody(req, Body);
    const user = await currentUser();
    if (!user) return apiError(401, "NO_SESSION", "Nothing to mark: this browser has no AgentBnB session.");
    await markNotificationsRead(user.id, ids);
    return Response.json({ unread: await countUnread(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
