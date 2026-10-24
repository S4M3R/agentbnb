import { getMyProfile } from "@/lib/profile";
import { currentUser } from "@/lib/session";

// The person behind this browser, for the header's account pill. Never mints a session:
// a visitor who hasn't done anything yet gets `{ user: null }`.
// GET /api/me
export async function GET() {
  const user = await currentUser();
  const profile = user ? await getMyProfile(user.id) : null;
  return Response.json({
    user: profile && { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl },
  });
}
