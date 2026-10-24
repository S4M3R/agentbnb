import { errorResponse, unauthenticated } from "@/lib/api-auth";
import { startCheck } from "@/lib/checks";
import { requestUser } from "@/lib/requests";

// The check keeps running after the response, inside this function's duration.
export const maxDuration = 300;

// Start a background check on the guest behind a request. Poll GET /api/v1/background-checks/{id}.
export async function POST(req: Request, ctx: RouteContext<"/api/v1/requests/[id]/background-check">) {
  const user = await requestUser(req);
  if (!user) return unauthenticated();
  const { id } = await ctx.params;
  try {
    const check = await startCheck(user.id, id);
    return Response.json({ check }, { status: check.started ? 202 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
