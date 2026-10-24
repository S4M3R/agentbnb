import { NextResponse, type NextRequest } from "next/server";
import { findConnectableAgent } from "@/lib/setup-guide";

// Content negotiation for the setup guide. /setup and /setup/<agent id> are HTML pages that carry
// the full instructions, so browsers, link unfurlers and agents that fetch HTML all get them. An
// agent that prefers Markdown (`Accept: text/markdown` or `text/plain` ranked above `text/html`)
// gets the same guide as Markdown, served by src/app/setup.md.

export const config = { matcher: ["/setup", "/setup/:agent"] };

/** The highest q any of `types` gets in an Accept header, 0 if none is listed (wildcards don't count). */
function quality(accept: string, types: string[]) {
  let best = 0;
  for (const part of accept.split(",")) {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    if (!types.includes(type.trim())) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    best = Math.max(best, q ? Number(q.slice(2)) || 0 : 1);
  }
  return best;
}

function wantsMarkdown(req: NextRequest) {
  const accept = req.headers.get("accept") ?? "";
  const md = quality(accept, ["text/markdown", "text/x-markdown", "text/plain"]);
  return md > 0 && md >= quality(accept, ["text/html", "application/xhtml+xml"]);
}

export function proxy(req: NextRequest) {
  if (!wantsMarkdown(req)) {
    const res = NextResponse.next();
    res.headers.set("vary", "accept");
    return res;
  }

  const id = req.nextUrl.pathname.split("/")[2];
  if (id && !findConnectableAgent(id)) {
    return new NextResponse(`# Not found\n\nThere's no setup guide for "${id}". The generic one is at ${req.nextUrl.origin}/setup.\n`, {
      status: 404,
      headers: { "content-type": "text/markdown; charset=utf-8", vary: "accept" },
    });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/setup.md";
  url.search = id ? `?agent=${encodeURIComponent(id)}` : "";
  return NextResponse.rewrite(url);
}
