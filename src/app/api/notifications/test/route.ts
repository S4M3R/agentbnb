import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiError } from "@/lib/api-auth";
import { notify } from "@/lib/notify";
import { currentUser } from "@/lib/session";

const TITLE = "Notifications are on";

// "Send a test": a notification to the person behind this browser only (push and the bell, no
// email), so they can check it arrives on their phone. At most one every 10 seconds.
// POST /api/notifications/test
export async function POST() {
  const user = await currentUser();
  if (!user) return apiError(401, "NO_SESSION", "Turn notifications on first.");
  const { notifications } = schema;
  const [recent] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        eq(notifications.title, TITLE),
        gt(notifications.createdAt, new Date(Date.now() - 10_000)),
      ),
    )
    .limit(1);
  if (recent) return apiError(429, "TOO_SOON", "One test at a time. Try again in a few seconds.");

  const id = await notify(user.id, {
    title: TITLE,
    body: "This is a test. You'll hear from me here when a host replies or I need you.",
    url: "/me/notifications",
    tag: "test",
    email: false,
  });
  const [row] = await db.select({ pushedAt: notifications.pushedAt }).from(notifications).where(eq(notifications.id, id));
  return Response.json({ id, pushed: row?.pushedAt != null });
}
