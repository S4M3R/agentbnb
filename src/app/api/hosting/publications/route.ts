import { after } from "next/server";
import { z } from "zod";
import { apiError, parseBody, errorResponse } from "@/lib/api-auth";
import { HostingError } from "@/lib/hosting/listings";
import { runPublication } from "@/lib/hosting/browser-agent";
import { claimRun, queuePublication } from "@/lib/hosting/publications";
import { webSession } from "@/lib/session";

// A browser run can take minutes; it continues in after() up to this limit.
export const maxDuration = 300;

const Body = z.object({ listingId: z.uuid(), network: z.string().min(1) });

/** The host clicked "Add" on a network: queue it and start the browser agent. */
export async function POST(req: Request) {
  try {
    const { listingId, network } = await parseBody(req, Body);
    const user = await (await webSession()).user();
    if (!user) return apiError(401, "NO_SESSION", "List your place in the chat first.");

    const queued = await queuePublication(user.id, listingId, network);
    const claimed = await claimRun(user.id, queued.id);
    if (claimed) after(() => runPublication(claimed.id));
    return Response.json({ publication: claimed ?? queued });
  } catch (err) {
    if (err instanceof HostingError) return apiError(400, "HOSTING_ERROR", err.message);
    return errorResponse(err);
  }
}
