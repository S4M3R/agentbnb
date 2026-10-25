import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getListingDetails } from "@/lib/agent/tools";
import { currentUser } from "@/lib/session";

// One listing for the chat's side panel when the guest clicks a stay card: the same details the agent's
// getListing tool returns, without asking the agent. Marketplace listings are public; AgentBnB hosts'
// places only once published, or to their own host.
// GET /api/listings/<id>

const notFound = () => Response.json({ error: { code: "NOT_FOUND", message: "No such listing." } }, { status: 404 });

export async function GET(_req: Request, ctx: RouteContext<"/api/listings/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return notFound();

  const [row] = await db
    .select({ sourceId: schema.listings.sourceId, status: schema.listings.status, hostUserId: schema.listings.hostUserId })
    .from(schema.listings)
    .where(and(eq(schema.listings.id, id)));
  if (!row) return notFound();
  if (row.sourceId === "internal" && row.status !== "active") {
    const user = await currentUser();
    if (!user || user.id !== row.hostUserId) return notFound();
  }

  const details = await getListingDetails(id);
  if ("error" in details) return notFound();
  return Response.json(details, { headers: { "cache-control": "private, max-age=60" } });
}
