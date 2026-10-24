import { after } from "next/server";
import { z } from "zod";
import { apiError, errorResponse, parseBody } from "@/lib/api-auth";
import { HostingError } from "@/lib/hosting/listings";
import { runPublication } from "@/lib/hosting/browser-agent";
import {
  claimRun,
  continuePublication,
  getPublication,
  markPublished,
  stopPublication,
} from "@/lib/hosting/publications";
import { webSession } from "@/lib/session";

export const maxDuration = 300;

async function hostId() {
  const user = await (await webSession()).user();
  if (!user) throw new HostingError("List your place in the chat first.");
  return user.id;
}

function fail(err: unknown) {
  if (err instanceof HostingError) return apiError(404, "NOT_FOUND", err.message);
  return errorResponse(err);
}

/** Polled by the chat card while the browser agent works. */
export async function GET(_req: Request, ctx: RouteContext<"/api/hosting/publications/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "NOT_FOUND", "No such publication.");
  try {
    return Response.json({ publication: await getPublication(await hostId(), id) });
  } catch (err) {
    return fail(err);
  }
}

const Action = z.discriminatedUnion("action", [
  /** Start a queued run (when the agent queued it from the chat) or retry a failed one. */
  z.object({ action: z.literal("start") }),
  /** The host did what the agent asked in the live browser. */
  z.object({ action: z.literal("continue") }),
  /** The host finished it themselves. */
  z.object({ action: z.literal("done"), externalUrl: z.url().optional() }),
  z.object({ action: z.literal("stop") }),
]);

export async function POST(req: Request, ctx: RouteContext<"/api/hosting/publications/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "NOT_FOUND", "No such publication.");
  try {
    const body = await parseBody(req, Action);
    const userId = await hostId();
    switch (body.action) {
      case "start": {
        const claimed = await claimRun(userId, id);
        if (claimed) after(() => runPublication(id));
        return Response.json({ publication: claimed ?? (await getPublication(userId, id)) });
      }
      case "continue": {
        const { publication, startRun } = await continuePublication(userId, id);
        if (startRun) after(() => runPublication(id));
        return Response.json({ publication });
      }
      case "done":
        return Response.json({ publication: await markPublished(userId, id, body.externalUrl) });
      case "stop":
        return Response.json({ publication: await stopPublication(userId, id) });
    }
  } catch (err) {
    return fail(err);
  }
}
