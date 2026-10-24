import { attentionFor } from "@/lib/attention";
import { currentUser } from "@/lib/session";

// What's waiting on the person behind this browser, for "Needs your attention" on the home screen.
// Never mints a session: a visitor who hasn't done anything yet gets an empty list.
// GET /api/attention
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ items: [] });
  return Response.json({ items: await attentionFor(user.id) });
}
