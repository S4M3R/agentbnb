import { errorResponse, parseBody, unauthenticated } from "@/lib/api-auth";
import { Decision, requestUser, respondToRequest } from "@/lib/requests";

export async function POST(req: Request, ctx: RouteContext<"/api/v1/requests/[id]/respond">) {
  const user = await requestUser(req);
  if (!user) return unauthenticated();
  const { id } = await ctx.params;
  try {
    const { decision } = await parseBody(req, Decision);
    return Response.json({ request: await respondToRequest(user.id, id, decision) });
  } catch (err) {
    return errorResponse(err);
  }
}
