// Tripalink (tripalink.com) coliving rooms in the Bay Area (currently Berkeley only).
//
//   npx tsx scripts/scrapers/tripalink.node.ts
//
// Public, server-rendered Next.js pages only: the market search pages
// /bay-area/homes-for-rent and /bay-area/apartments-for-rent, then each property page
// /apartments/bay-area/<city>/<id>. Everything is read from the page's own
// __NEXT_DATA__ (no /_next/data/ or API calls; /_next/data/ is disallowed in robots.txt).
// One item per bookable room (or whole unit), skipping rooms marked "Rented Out".
// Sequential, >= 1.2s apart, honest User-Agent; stops on 403/429/challenge. Writes
// data/scrapes/tripalink-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://tripalink.com";
const SEARCH_PATHS = ["/bay-area/homes-for-rent", "/bay-area/apartments-for-rent"];
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const DELAY_MS = 1200;

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
function nextData(html: string): Any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NEXT_DATA__");
  return JSON.parse(m[1]);
}

const pick = (o: Any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));

async function main() {
  const startedAt = new Date().toISOString();
  const items: unknown[] = [];
  let complete = true;
  let error: string | null = null;

  try {
    const properties = new Map<string, Any>();
    const links = new Map<string, string>();
    for (const path of SEARCH_PATHS) {
      const html = await get(path);
      for (const m of html.matchAll(/href="(\/apartments\/bay-area\/[a-z-]+\/(\d+))"/g)) links.set(m[2], m[1]);
      const es = nextData(html).props.pageProps.data.ESProperties;
      if (es.pageInfo.total > es.data.length) complete = false; // single page assumed (20/page)
      for (const p of es.data) properties.set(String(p.id), p);
    }
    console.log(`${properties.size} Bay Area properties`);

    for (const [id, summary] of properties) {
      const path = links.get(id) ?? `/apartments/bay-area/${String(summary.city).toLowerCase().replace(/\s+/g, "-")}/${id}`;
      try {
        const pp = nextData(await get(path)).props.pageProps;
        const d = pp.data;
        const property = {
          ...pick(d, [
            "id",
            "name",
            "isColiving",
            "minPrice",
            "maxPrice",
            "introduce",
            "longitude",
            "latitude",
            "address",
            "sellingHeadline",
            "aiIntroduceKeywords",
            "area",
            "city",
            "state",
            "zipoCode",
            "propertyType",
            "marketingTag",
            "minBd",
            "maxBd",
            "minBa",
            "maxBa",
            "updateTime",
          ]),
          url: new URL(path, BASE).href,
          photos: (d.picList ?? []).map((p: Any) => ({ url: p.url, tag: p.tag ?? null })),
          amenities: (d.amenities ?? []).filter((a: Any) => a.catalogValue).map((a: Any) => ({ name: a.catalogName, level: a.level })),
          campaign: d.campaign ? pick(d.campaign, ["campaignName", "campaignDescription", "campaignStartTime", "campaignEndTime"]) : null,
          rentalPolicy: (pp.rentalPolicyData ?? []).map((r: Any) => ({ type: r.type, values: r.values })),
        };
        let n = 0;
        for (const fp of d.floorPlanModeUnit ?? []) {
          for (const u of fp.availableUnits ?? []) {
            const unit = {
              ...pick(u, ["id", "name", "floorPlanBedroomNum", "floorPlanBathroomNum", "totalArea", "rentWhole", "sharedBathroom", "originalPrice"]),
              floorPlans: (u.floorPlans ?? []).map((f: Any) => f.url),
              amenities: (u.amenities ?? []).filter((a: Any) => a.catalogValue).map((a: Any) => a.catalogName),
              minOnePersonPrice: u.minOnePersonPrice ?? null,
            };
            for (const r of u.rooms ?? []) {
              if (!r.show || !r.availableStartTime || r.availableContent === "Rented Out") continue;
              if (r.availableStartTime > 8.64e15) continue; // Long.MAX sentinel = never
              items.push({
                scrapedAt: new Date().toISOString(),
                property,
                unit,
                room: {
                  ...pick(r, ["id", "name", "price", "originalPrice", "priceReduction", "virtual", "totalArea", "availableStartTime", "availableContent", "roomConcessionDesc"]),
                  photos: (r.picList ?? []).map((p: Any) => p.url),
                  floorPlans: (r.floorPlans ?? []).map((f: Any) => f.url),
                  vrUrl: r.vrUrl?.[0]?.url ?? null,
                  videoUrl: r.videoUrl?.[0]?.url ?? null,
                  amenities: (r.amenities ?? []).filter((a: Any) => a.catalogValue).map((a: Any) => a.catalogName),
                },
              });
              n++;
            }
          }
        }
        console.log(`  ${d.name}: ${n} available room(s)/unit(s)`);
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
  const path = `data/scrapes/tripalink-sf-bay-area-${finishedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(
    path,
    JSON.stringify({ source: "tripalink", market: "sf-bay-area", startedAt, finishedAt, complete, error, items }, null, 2),
  );
  console.log(`${items.length} items → ${path} (complete: ${complete})`);
}

main();
