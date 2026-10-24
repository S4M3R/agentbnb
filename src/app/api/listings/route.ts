import { z } from "zod";
import { isAdminRequest } from "@/lib/admin-auth";
import { createInternalListing, NewInternalListing } from "@/lib/listings";

// Admin: create a listing on our own network. Replaced by the agent's
// `listMyPlace` tool once user auth exists.
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = NewInternalListing.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  const listing = await createInternalListing(parsed.data);
  return Response.json({ listing }, { status: 201 });
}
