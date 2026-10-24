// Airbnb budget stays (rooms first, plus the cheapest entire places) in the SF Bay Area,
// from public search result pages.
//
//   npx tsx scripts/scrapers/airbnb.node.ts
//
// Fetches /s/<place>/homes search pages for a fixed 2-night window with a room-type
// filter ("Room" = private + shared rooms, "Entire home/apt") and a nightly price cap.
// Results come from the page's embedded JSON (<script id="data-injector-instances">,
// staysSearch.results.searchResults); pages are walked with the page's own cursors.
// No detail pages, no login, no API calls. Sequential, >= 2.5s apart, honest User-Agent;
// stops on 403/429/503 or any bot challenge. Capped at MAX_ITEMS listings, so the run is
// always written as complete=false. Writes data/scrapes/airbnb-sf-bay-area-<ts>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.airbnb.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const DELAY_MS = 2500;
const MAX_ITEMS = 300;
const PAGE_SIZE = 18;

/** Near-future weekday window so search results show real prices. */
const CHECK_IN = "2026-11-10";
const CHECK_OUT = "2026-11-12";
const NIGHTS = 2;

type RoomFilter = "Private room" | "Entire home/apt";
type Query = { place: string; area: string; roomType: RoomFilter; priceMax: number; pages: number };

/** Rooms across the Bay Area, then a few pages of the cheapest entire places. */
const QUERIES: Query[] = [
  { place: "San-Francisco--CA", area: "San Francisco", roomType: "Private room", priceMax: 110, pages: 5 },
  { place: "Oakland--CA", area: "Oakland", roomType: "Private room", priceMax: 80, pages: 3 },
  { place: "Berkeley--CA", area: "Berkeley", roomType: "Private room", priceMax: 90, pages: 2 },
  { place: "San-Jose--CA", area: "San Jose", roomType: "Private room", priceMax: 80, pages: 3 },
  { place: "San-Mateo--CA", area: "Peninsula", roomType: "Private room", priceMax: 100, pages: 2 },
  { place: "Palo-Alto--CA", area: "Peninsula", roomType: "Private room", priceMax: 100, pages: 2 },
  { place: "San-Rafael--CA", area: "Marin", roomType: "Private room", priceMax: 120, pages: 1 },
  { place: "Fremont--CA", area: "East Bay", roomType: "Private room", priceMax: 80, pages: 1 },
  { place: "Walnut-Creek--CA", area: "East Bay", roomType: "Private room", priceMax: 90, pages: 1 },
  { place: "San-Francisco--CA", area: "San Francisco", roomType: "Entire home/apt", priceMax: 130, pages: 2 },
  { place: "Oakland--CA", area: "Oakland", roomType: "Entire home/apt", priceMax: 100, pages: 1 },
  { place: "San-Jose--CA", area: "San Jose", roomType: "Entire home/apt", priceMax: 100, pages: 1 },
];

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
let blocks = 0;

async function get(path: string, attempt = 1): Promise<string> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    if (attempt >= 3) throw err;
    await sleep(3000 * 2 ** attempt);
    return get(path, attempt + 1);
  }
  const body = await res.text();
  const challenged =
    /<title>Just a moment|cf_chl_opt|cf-chl-|px-captcha|captcha-delivery\.com|geo\.captcha-delivery/i.test(body) ||
    (res.ok && !body.includes("data-injector-instances"));
  if (res.status === 403 || res.status === 429 || challenged) {
    blocks++;
    if (blocks >= 2 || attempt >= 2) throw new StopError(`${path}: blocked (${res.status}); stopping`);
    await sleep(15000);
    return get(path, attempt + 1);
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(3000 * 2 ** attempt);
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return body;
}

type Obj = Record<string, unknown>;

/** The `staysSearch.results` object embedded in a search page. */
function searchResults(html: string): Obj | null {
  const m = html.match(/<script id="data-injector-instances"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let found: Obj | null = null;
  const walk = (o: unknown) => {
    if (found || !o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Obj)) {
      if (k === "searchResults" && Array.isArray(v)) {
        found = o as Obj;
        return;
      }
      walk(v);
    }
  };
  walk(JSON.parse(m[1]));
  return found;
}

/** Drop GraphQL/logging noise so the raw items stay readable. */
function slim(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(slim);
  if (!o || typeof o !== "object") return o;
  const out: Obj = {};
  for (const [k, v] of Object.entries(o as Obj)) {
    if (k === "__typename" || k === "loggingMetadata" || k === "loggingContext" || k === "wishlistItems") continue;
    out[k] = slim(v);
  }
  return out;
}

/** "DemandStayListing:774323" (base64) → "774323". */
function listingId(r: Obj): string | null {
  const enc = (r.demandStayListing as Obj | undefined)?.id;
  if (typeof enc !== "string") return null;
  const dec = Buffer.from(enc, "base64").toString("utf8");
  return dec.match(/:(\d+)$/)?.[1] ?? null;
}

function searchUrl(q: Query, page: number) {
  const params = new URLSearchParams({
    checkin: CHECK_IN,
    checkout: CHECK_OUT,
    adults: "1",
    currency: "USD",
    price_filter_input_type: "0",
    price_max: String(q.priceMax),
    price_filter_num_nights: String(NIGHTS),
  });
  params.append("room_types[]", q.roomType);
  if (page > 0) {
    const cursor = Buffer.from(JSON.stringify({ section_offset: 0, items_offset: page * PAGE_SIZE, version: 1 })).toString(
      "base64",
    );
    params.set("cursor", cursor);
  }
  return `/s/${q.place}/homes?${params}`;
}

async function main() {
  const startedAt = new Date().toISOString();
  const searchedAt = startedAt.slice(0, 10);
  const items: Obj[] = [];
  const seen = new Set<string>();
  const notes: string[] = [];

  try {
    outer: for (const q of QUERIES) {
      let total: number | null = null;
      for (let page = 0; page < q.pages; page++) {
        const html = await get(searchUrl(q, page));
        const res = searchResults(html);
        if (!res) throw new Error(`${q.place} p${page}: no search results payload`);
        const filters = (res.filters as Obj | undefined)?.filterPanel as Obj | undefined;
        total = (filters?.resultCount as number | undefined) ?? total;
        const results = res.searchResults as Obj[];
        let added = 0;
        for (const r of results) {
          const id = listingId(r);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          added++;
          items.push({
            id,
            url: `${BASE}/rooms/${id}`,
            searchedAt,
            checkIn: CHECK_IN,
            checkOut: CHECK_OUT,
            nights: NIGHTS,
            query: { place: q.place, area: q.area, roomTypeFilter: q.roomType, priceMaxPerNight: q.priceMax },
            result: slim(r),
          });
          if (items.length >= MAX_ITEMS) {
            notes.push(`capped at ${MAX_ITEMS} listings`);
            console.log(`${q.place} ${q.roomType} p${page}: +${added} (cap reached)`);
            break outer;
          }
        }
        console.log(`${q.place} ${q.roomType} <=$${q.priceMax} p${page}: ${results.length} results, +${added} new (total ${total ?? "?"})`);
        if (results.length < PAGE_SIZE || (total != null && (page + 1) * PAGE_SIZE >= total)) break;
      }
    }
  } catch (err) {
    console.error(err instanceof StopError ? err.message : err);
    notes.push(String(err instanceof Error ? err.message : err));
  }

  const finishedAt = new Date().toISOString();
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/airbnb-${MARKET}-${finishedAt.replace(/[:.]/g, "-")}.json`;
  // Always partial: capped, price-filtered searches never cover all of Airbnb's Bay Area inventory.
  await writeFile(path, JSON.stringify({ source: "airbnb", market: MARKET, startedAt, finishedAt, complete: false, notes, items }, null, 2));
  console.log(`wrote ${items.length} items to ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
