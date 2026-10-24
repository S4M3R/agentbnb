import { after } from "next/server";
import { z } from "zod";
import { apiError, parseBody, errorResponse } from "@/lib/api-auth";
import { HostingError } from "@/lib/hosting/listings";
import { runPublication } from "@/lib/hosting/browser-agent";
import { claimRun, publishToNetworks, queuePublication } from "@/lib/hosting/publications";
import { webSession } from "@/lib/session";

// A browser run can take minutes; it continues in after() up to this limit.
export const maxDuration = 300;

const Body = z.union([
  /** One network: the host clicked Retry, or an older client. */
  z.object({ listingId: z.uuid(), network: z.string().min(1) }),
  /** "Publish to N sites": queue them all, start as many as MAX_PARALLEL_RUNS allows. */
  z.object({ listingId: z.uuid(), networks: z.array(z.string().min(1)).min(1).max(12) }),
]);

/** Queue the listing on one or more networks and start the browser agent. */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, Body);
    const user = await (await webSession()).user();
    if (!user) return apiError(401, "NO_SESSION", "List your place in the chat first.");

    if ("networks" in body) {
      const { publications, started } = await publishToNetworks(user.id, body.listingId, body.networks);
      for (const id of started) after(() => runPublication(id));
      return Response.json({ publications });
    }

    const queued = await queuePublication(user.id, body.listingId, body.network);
    const claimed = await claimRun(user.id, queued.id);
    if (claimed) after(() => runPublication(claimed.id));
    return Response.json({ publication: claimed ?? queued });
  } catch (err) {
    if (err instanceof HostingError) return apiError(400, "HOSTING_ERROR", err.message);
    return errorResponse(err);
  }
}
