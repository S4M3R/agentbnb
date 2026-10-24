// Anyplace furnished monthly apartments in the SF Bay Area.
//
//   npx tsx scripts/scrapers/anyplace.node.ts [limit]
//
// Reads the public listings sitemap (robots.txt allows it), keeps listings in
// Bay Area city slugs, and fetches each public, server-rendered listing page,
// taking the listing record out of its Next.js __NEXT_DATA__ payload. Review
// text, reviewer names and street addresses are dropped before writing.
// Sequential, >= 1.5s apart, honest User-Agent; stops on 403/429 or a bot
// challenge. Writes data/scrapes/anyplace-<market>-<ts>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.anyplace.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const BAY_AREA_CITY_SLUGS = new Set(["san-francisco", "santa-clara", "oakland", "san-jose", "berkeley", "palo-alto", "mountain-view", "sunnyvale", "redwood-city", "san-mateo"]);
const DELAY_MS = 1500;

const limit = process.argv[2] ? Number(process.argv[2]) : Infinity;

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string, attempt = 1): Promise<string | null> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT } });
  if (res.status === 403 || res.status === 429) throw new StopError(`${path}: blocked (${res.status}); stopping`);
  if (res.status === 404 || res.status === 410) return null;
  const body = await res.text();
  if (/<title>(Just a moment|Attention Required)|cf_chl_opt|cf-chl-/i.test(body)) {
    throw new StopError(`${path}: bot challenge; stopping`);
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(3000 * attempt);
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return body;
}

type Json = Record<string, unknown>;

function propertyInfo(html: string): Json | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  const next = JSON.parse(m[1]);
  const state = next?.props?.pageProps?.urqlState ?? {};
  for (const entry of Object.values(state) as { data?: string }[]) {
    if (!entry?.data) continue;
    const data = JSON.parse(entry.data);
    if (data?.propertyInfo) return data.propertyInfo as Json;
  }
  return null;
}

/** Keep listing facts; drop review text/authors, street address, unit number. */
function strip(p: Json) {
  const {
    reviews: _reviews,
    hotelsMetadataReviews: _metaReviews,
    address: _address,
    unitNumber: _unit,
    faqProperties: _faq,
    ...rest
  } = p;
  return rest;
}

async function main() {
  const startedAt = new Date().toISOString();
  const items: unknown[] = [];
  const errors: { id: string; error: string }[] = [];
  let status: "done" | "failed" = "done";

  try {
    const sitemap = (await get("/listings-sitemap.xml")) ?? "";
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1].trim())
      .filter((u) => BAY_AREA_CITY_SLUGS.has(new URL(u).pathname.split("/")[2] ?? ""));
    console.log(`${urls.length} Bay Area listing URLs in sitemap`);

    for (const url of urls.slice(0, limit)) {
      const path = new URL(url).pathname;
      try {
        const html = await get(path);
        if (!html) {
          console.log(`  - ${path}: gone`);
          continue;
        }
        const p = propertyInfo(html);
        if (!p) {
          errors.push({ id: path, error: "no propertyInfo" });
          continue;
        }
        items.push({ url, ...strip(p) });
        console.log(`  ✓ ${path}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        errors.push({ id: path, error: String(err) });
        console.error(`  ✗ ${path}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  const complete = status === "done" && limit === Infinity && !errors.length;
  const file = { source: "anyplace", market: MARKET, startedAt, finishedAt: new Date().toISOString(), complete, items };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/anyplace-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log({ path, items: items.length, errors: errors.length, complete });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
