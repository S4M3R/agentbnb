// Outsite (outsite.co) coliving houses in the Bay Area (San Francisco: Mission and
// Pacific Heights).
//
//   npx tsx scripts/scrapers/outsite.node.ts
//
// Public, server-rendered location pages only (/locations/<slug>; robots.txt only
// disallows /api/, which is never touched). Room types and their public
// nightly/weekly/monthly rates are read from the page's own React Server Components
// payload (self.__next_f), plus the JSON-LD Hotel block for address, photos, and
// amenities. One item per room type. Sequential, >= 1.2s apart, honest User-Agent;
// stops on 403/429/challenge. Writes data/scrapes/outsite-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.outsite.co";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const DELAY_MS = 1200;
// Bay Area slugs from https://www.outsite.co/sitemap.xml (checked 2026-10).
const DEFAULT_SLUGS = ["san-francisco-mission", "san-francisco-pacific-heights"];
// Bounds of the sf-bay-area market (src/lib/markets.ts): used to pick up new houses.
const BAY = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 };

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string, attempt = 1): Promise<string> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT } });
  const body = await res.text();
  if (res.status === 403 || res.status === 429 || /<title>Just a moment|cf_chl_opt|g-recaptcha|h-captcha/i.test(body)) {
    throw new StopError(`${path}: blocked (${res.status}); stopping`);
  }
  if (res.status >= 500 && attempt < 4) {
    await sleep(2000 * 2 ** attempt);
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return body;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped page payload
type Any = any;

/** Concatenate the RSC flight chunks and pull out the first `"__typename":"Property"` object. */
function propertyFromRsc(html: string): Any {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1]));
  const s = chunks.join("");
  const at = s.indexOf('"__typename":"Property"');
  if (at === -1) throw new Error("no Property object in page payload");
  const start = s.lastIndexOf("{", at);
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("unterminated Property object");
}

function hotelLd(html: string): Any {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j["@type"] === "Hotel") return j;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function main() {
  const startedAt = new Date().toISOString();
  const items: unknown[] = [];
  let complete = true;
  let error: string | null = null;

  try {
    const sitemap = await get("/sitemap.xml");
    const all = [...sitemap.matchAll(/<loc>https:\/\/www\.outsite\.co\/locations\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1]);
    // Only the known Bay Area slugs plus any new san-francisco/bay-area ones.
    const slugs = [...new Set([...DEFAULT_SLUGS, ...all.filter((s) => /san-francisco|oakland|berkeley|santa-cruz|bay-area/.test(s))])];
    console.log(`slugs: ${slugs.join(", ")}`);

    for (const slug of slugs) {
      const path = `/locations/${slug}`;
      try {
        const html = await get(path);
        const property = propertyFromRsc(html);
        const ld = hotelLd(html);
        const lat = property.latitude ?? ld?.geo?.latitude;
        const lng = property.longitude ?? ld?.geo?.longitude;
        if (!(lat <= BAY.north && lat >= BAY.south && lng <= BAY.east && lng >= BAY.west)) {
          console.log(`  ${slug}: outside the Bay Area, skipped`);
          continue;
        }
        const { roomTypes, recommendedProperties: _r, localRecommendations: _l, reviewsV2, cmsContent, ...rest } = property;
        const house = {
          ...rest,
          slug,
          url: `${BASE}${path}`,
          reviewCount: reviewsV2?.count ?? null,
          cmsName: cmsContent?.name ?? null,
          propertyType: cmsContent?.propertyType?.name ?? null,
          ld: ld && {
            name: ld.name,
            description: ld.description,
            image: ld.image,
            address: ld.address,
            checkinTime: ld.checkinTime,
            checkoutTime: ld.checkoutTime,
            amenities: (ld.amenityFeature ?? []).filter((a: Any) => a.value).map((a: Any) => a.name),
          },
        };
        for (const rt of roomTypes ?? []) {
          items.push({ scrapedAt: new Date().toISOString(), house, roomType: rt });
        }
        console.log(`  ${slug}: ${roomTypes?.length ?? 0} room type(s)`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        complete = false;
        console.error(`  ✗ ${path}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    complete = false;
    error = err instanceof Error ? err.message : String(err);
    console.error(error);
  }

  const finishedAt = new Date().toISOString();
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/outsite-sf-bay-area-${finishedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(
    path,
    JSON.stringify({ source: "outsite", market: "sf-bay-area", startedAt, finishedAt, complete, error, items }, null, 2),
  );
  console.log(`${items.length} room types → ${path} (complete: ${complete})`);
}

main();
