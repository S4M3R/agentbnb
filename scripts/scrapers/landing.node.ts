// Landing (hellolanding.com) furnished apartments in the SF Bay Area.
//
//   npx tsx scripts/scrapers/landing.node.ts [limit]
//
// Uses Landing's own public, no-auth agent API (/api/public, explicitly allowed
// in robots.txt and documented at /llms.txt): list markets, search each
// California market, and fetch each in-bounds home's detail (photos, amenities,
// availability calendar). Sequential, >= 1.2s apart, honest User-Agent. Stops
// on 403/429 or a bot challenge. Writes data/scrapes/landing-<market>-<ts>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.hellolanding.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const BOUNDS = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 };
const DELAY_MS = 1200;

const limit = process.argv[2] ? Number(process.argv[2]) : Infinity;

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function getJson<T>(path: string, attempt = 1): Promise<T> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(new URL(path, BASE), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (res.status === 403 || res.status === 429) throw new StopError(`${path}: blocked (${res.status}); stopping`);
  const body = await res.text();
  if (/<title>Just a moment|cf_chl_opt|g-recaptcha|h-captcha/i.test(body)) {
    throw new StopError(`${path}: bot challenge; stopping`);
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(2000 * attempt);
    return getJson(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return JSON.parse(body) as T;
}

const inBounds = (lat?: number | null, lng?: number | null) =>
  lat != null &&
  lng != null &&
  lat <= BOUNDS.north &&
  lat >= BOUNDS.south &&
  lng <= BOUNDS.east &&
  lng >= BOUNDS.west;

type Market = { slug: string; name: string; state: string };
type SearchHome = { slug: string; latitude: number | null; longitude: number | null; [k: string]: unknown };
type SearchPage = { total_pages: number; total_count: number; homes: SearchHome[] };

async function main() {
  const startedAt = new Date().toISOString();
  const items: unknown[] = [];
  const errors: { id: string; error: string }[] = [];
  let status: "done" | "failed" = "done";

  try {
    const { markets } = await getJson<{ markets: Market[] }>("/api/public/markets?state=CA");
    const ca = markets.filter((m) => m.state === "CA");
    console.log(`CA markets: ${ca.map((m) => m.slug).join(", ")}`);

    const cards = new Map<string, SearchHome>();
    for (const m of ca) {
      for (let page = 1; ; page++) {
        const res = await getJson<SearchPage>(
          `/api/public/search?market=${encodeURIComponent(m.slug)}&per_page=40&page=${page}`,
        );
        const local = res.homes.filter((h) => inBounds(h.latitude, h.longitude));
        for (const h of local) cards.set(h.slug, { ...h, searchMarket: m.slug });
        console.log(`  ${m.slug} p${page}: ${res.homes.length} homes, ${local.length} in Bay Area (total ${res.total_count})`);
        // Markets wholly outside the Bay Area (LA, San Diego, ...) stop after page 1.
        if (!local.length || page >= res.total_pages) break;
      }
    }

    for (const card of [...cards.values()].slice(0, limit)) {
      try {
        const detail = await getJson<Record<string, unknown>>(`/api/public/homes/${encodeURIComponent(card.slug)}`);
        items.push({ ...card, ...detail, searchMarket: card.searchMarket });
        console.log(`  ✓ ${card.slug}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        errors.push({ id: card.slug, error: String(err) });
        console.error(`  ✗ ${card.slug}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  const complete = status === "done" && limit === Infinity && !errors.length;
  const file = { source: "landing", market: MARKET, startedAt, finishedAt: new Date().toISOString(), complete, items };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/landing-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log({ path, items: items.length, errors: errors.length, complete });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
