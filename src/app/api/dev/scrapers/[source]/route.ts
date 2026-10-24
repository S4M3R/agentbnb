import { readFile } from "node:fs/promises";
import path from "node:path";

// Dev-only: serves scripts/scrapers/<source>.browser.js so a browser tab on the
// source site can load the current scraper without copy-pasting it.

function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function GET(req: Request, ctx: RouteContext<"/api/dev/scrapers/[source]">) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const { source } = await ctx.params;
  if (!/^[a-z0-9-]+$/.test(source)) return new Response("Bad source", { status: 400 });
  try {
    const file = path.join(process.cwd(), "scripts/scrapers", `${source}.browser.js`);
    const code = await readFile(file, "utf8");
    return new Response(code, {
      headers: { ...cors(req), "Content-Type": "text/javascript; charset=utf-8" },
    });
  } catch {
    return new Response("Not found", { status: 404, headers: cors(req) });
  }
}
