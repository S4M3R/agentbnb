import { apiError, unauthenticated } from "@/lib/api-auth";
import { getCheck } from "@/lib/checks";
import { requestUser } from "@/lib/requests";

// A check, for the host who ran it or the guest it's about. `?after=<event id>` returns only newer events.
export async function GET(req: Request, ctx: RouteContext<"/api/v1/background-checks/[id]">) {
  const user = await requestUser(req);
  if (!user) return unauthenticated();
  const { id } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  const check = await getCheck(user.id, id, Number.isSafeInteger(after) && after > 0 ? after : 0);
  if (!check) return apiError(404, "CHECK_NOT_FOUND", "No background check with that id.");
  return Response.json({ check }, { headers: { "cache-control": "no-store" } });
}
