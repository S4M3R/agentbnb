import { z } from "zod";
import { isAdminRequest } from "@/lib/admin-auth";
import { finishRun, recordBatch, startRun, upsertListing } from "@/lib/ingest";
import { ADAPTERS } from "@/lib/sources";

// Push scraped records straight into the database (alternative to downloading a
// scrape file and running `pnpm ingest`). Callable cross-origin from a browser
// tab on the source site; guarded by a bearer token.

export const maxDuration = 300;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), market: z.string().nullable().default(null) }),
  z.object({ action: z.literal("batch"), runId: z.uuid(), items: z.array(z.unknown()).max(100) }),
  z.object({ action: z.literal("finish"), runId: z.uuid(), error: z.string().nullish() }),
]);

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    // Chrome Private Network Access: public site -> localhost during local scraping.
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request, ctx: RouteContext<"/api/ingest/[source]">) {
  const headers = corsHeaders(req);
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401, headers });

  const { source } = await ctx.params;
  const adapter = ADAPTERS[source];
  if (!adapter) return Response.json({ error: `no adapter for ${source}` }, { status: 404, headers });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers });
  }
  const body = parsed.data;

  if (body.action === "start") {
    const run = await startRun(adapter.sourceId, body.market);
    return Response.json({ runId: run.id }, { headers });
  }

  if (body.action === "finish") {
    const run = await finishRun(body.runId, { error: body.error });
    return Response.json({ run }, { headers });
  }

  const counts = { found: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 };
  const errors: { index: number; error: string }[] = [];
  for (const [index, raw] of body.items.entries()) {
    const item = adapter.normalize(raw);
    if (!item) {
      counts.skipped++;
      continue;
    }
    counts.found++;
    try {
      const { result } = await upsertListing(adapter.sourceId, item);
      counts[result]++;
    } catch (err) {
      errors.push({ index, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await recordBatch(body.runId, counts);
  return Response.json({ counts, errors }, { headers });
}
