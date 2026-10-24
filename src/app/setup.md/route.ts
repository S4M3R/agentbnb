import { findConnectableAgent, setupMarkdown } from "@/lib/setup-guide";

// The setup guide as Markdown. The home banner's prompts now point at /setup/<agent id> (an HTML page
// with the same steps, see src/app/setup); this URL stays for agents and links that already use it,
// and is where src/proxy.ts sends /setup/<id> requests that ask for text/markdown. `?agent=<id>`
// (see CONNECTABLE_AGENTS) tailors the registration and key-storage steps. Full API reference: /docs.md.

export function GET(req: Request) {
  const url = new URL(req.url);
  // Rewritten requests from the proxy keep their original URL, /setup/<id>, so take the id from there too.
  const agent = findConnectableAgent(url.searchParams.get("agent") ?? url.pathname.match(/^\/setup\/([^/]+)$/)?.[1]);
  return new Response(setupMarkdown(url.origin, agent), {
    headers: { "content-type": "text/markdown; charset=utf-8", vary: "accept" },
  });
}
