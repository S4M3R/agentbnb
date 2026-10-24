import { z } from "zod";
import { apiError, authenticate, errorResponse, revokeKey, unauthenticated } from "@/lib/api-auth";

export async function DELETE(req: Request, ctx: RouteContext<"/api/v1/keys/[id]">) {
  const principal = await authenticate(req);
  if (!principal) return unauthenticated();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "KEY_NOT_FOUND", "No active key with that id.");
  try {
    return Response.json({ revoked: await revokeKey(principal, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
