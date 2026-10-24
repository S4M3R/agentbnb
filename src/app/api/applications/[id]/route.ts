import { z } from "zod";
import { latestAsk, type NeedsUserAsk } from "@/lib/access";
import { ApplicationError, getApplication } from "@/lib/applications";
import { loadPhotos } from "@/lib/listing-cards";
import { webSession } from "@/lib/session";

// One of the guest's applications for the chat's side panel: the listing, the intro and the timeline.
// GET /api/applications/<uuid>
export async function GET(_req: Request, ctx: RouteContext<"/api/applications/[id]">) {
  const { id } = await ctx.params;
  const notFound = Response.json({ error: { code: "NOT_FOUND", message: "No such application." } }, { status: 404 });
  const user = await (await webSession()).user();
  if (!user || !z.uuid().safeParse(id).success) return notFound;

  const app = await getApplication(id, user.id).catch((err) => {
    if (err instanceof ApplicationError) return null;
    throw err;
  });
  if (!app || app.role !== "guest") return notFound;

  const photos = (await loadPhotos([app.listing.id], 5)).get(app.listing.id) ?? [];
  return Response.json({
    id: app.id,
    status: app.status,
    statusMessage: app.statusMessage,
    channel: app.channel,
    startDate: app.startDate,
    endDate: app.endDate,
    arrival: app.arrival,
    intro: app.intro,
    liveViewUrl: app.liveViewUrl,
    ask: latestAsk(app.status, app.timeline),
    listing: { id: app.listing.id, title: app.listing.title, type: app.listing.type, url: app.listing.externalUrl },
    source: app.source,
    photos,
    timeline: app.timeline.map((e) => ({
      id: e.id,
      kind: e.kind,
      actor: e.actor,
      body: e.body,
      pending: e.data.delivery === "pending",
      createdAt: e.createdAt,
    })),
  });
}

type App = Awaited<ReturnType<typeof getApplication>>;

/** What GET returns, for the chat's ApplicationPanel. */
export type ApplicationDetail = Pick<App, "id" | "status" | "statusMessage" | "channel" | "startDate" | "endDate" | "arrival" | "intro" | "liveViewUrl" | "source"> & {
  listing: { id: string; title: string; type: string; url: string | null };
  photos: string[];
  /** What a needs_user application is waiting for (a login, an email), for the right form. */
  ask: NeedsUserAsk | null;
  timeline: { id: string; kind: string; actor: string; body: string | null; pending: boolean; createdAt: string }[];
};
