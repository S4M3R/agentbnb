import { hasSomethingToHear, inbox } from "@/lib/notify";
import { currentUser } from "@/lib/session";

// The header's bell: the person's newest notifications, how many are unread, and whether they have
// anything going on that's worth turning push on for (the home's one-time banner).
// Never mints a session: a visitor who hasn't done anything yet gets an empty inbox.
// GET /api/notifications
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ items: [], unread: 0, worthHearing: false });
  const [{ items, unread }, worthHearing] = await Promise.all([inbox(user.id), hasSomethingToHear(user.id)]);
  return Response.json({ items, unread, worthHearing });
}
