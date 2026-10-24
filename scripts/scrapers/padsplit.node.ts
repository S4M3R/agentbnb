// PadSplit scraper: weekly-priced furnished rooms in shared homes around the SF Bay Area.
//
//   npx tsx scripts/scrapers/padsplit.node.ts [limit]
//
// Discovers properties from the public homes sitemap (CA listings), the server-rendered
// city search pages (/rooms-for-rent/<city>-ca) and each property's "nearby homes", then
// fetches each public property page and reads its embedded __NEXT_DATA__ JSON. Keeps only
// properties inside the sf-bay-area bounds. Strips street addresses and operator last
// names before writing. Sequential, >= 1.5s between requests, honest User-Agent; stops on
// 403/429 or any bot challenge. Writes data/scrapes/padsplit-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

// Untyped third-party JSON payloads.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const BASE = "https://www.padsplit.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const DELAY_MS = 1500;
const CAP = 300; // rooms
const BOUNDS = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 };
const CITY_SLUGS = [
  "san-francisco-ca", "oakland-ca", "berkeley-ca", "san-jose-ca", "concord-ca", "fremont-ca",
  "hayward-ca", "richmond-ca", "vallejo-ca", "san-mateo-ca", "redwood-city-ca", "daly-city-ca",
  "crockett-ca", "antioch-ca", "santa-rosa-ca", "fairfield-ca",
];
// Sitemap city segments (…/listing/ca/<city>/…) worth fetching; bounds are checked per property.
const SITEMAP_CITIES = new Set([
  "san-francisco", "oakland", "berkeley", "emeryville", "alameda", "san-jose", "concord", "fremont",
  "hayward", "richmond", "vallejo", "crockett", "san-mateo", "redwood-city", "daly-city", "antioch",
  "pittsburg", "santa-rosa", "fairfield", "san-leandro", "union-city", "milpitas", "santa-clara",
  "sunnyvale", "mountain-view", "palo-alto", "napa", "petaluma", "san-rafael", "novato", "walnut-creek",
  "pleasanton", "livermore", "dublin", "san-pablo", "el-cerrito", "martinez", "benicia", "half-moon-bay",
  "south-san-francisco", "san-bruno", "pacifica", "east-palo-alto", "menlo-park", "gilroy", "morgan-hill",
  "santa-cruz", "watsonville", "suisun-city", "vacaville", "brentwood", "oakley", "castro-valley",
]);

const limit = process.argv[2] ? Number(process.argv[2]) : CAP;

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(url: string, attempt = 1): Promise<{ status: number; body: string }> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetch(new URL(url, BASE), { headers: { "User-Agent": USER_AGENT }, redirect: "manual" });
  } catch (err) {
    if (attempt < 4) {
      await sleep(2000 * attempt);
      return get(url, attempt + 1);
    }
    throw err;
  }
  const body = await res.text();
  const challenged = /<title>Just a moment|cf_chl_opt|g-recaptcha|h-captcha|captcha-delivery|px-captcha/i.test(body);
  if (res.status === 403 || res.status === 429 || challenged) throw new StopError(`${url}: blocked (${res.status})`);
  if (res.status >= 500 && attempt < 4) {
    await sleep(3000 * attempt);
    return get(url, attempt + 1);
  }
  return { status: res.status, body };
}

type Query = { queryKey: unknown[]; state: { data: unknown } };
function nextQueries(html: string): Query[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  return JSON.parse(m[1])?.props?.pageProps?.dehydratedState?.queries ?? [];
}
const query = (qs: Query[], key: string) => qs.find((q) => q.queryKey[0] === key)?.state.data as Json;

const inBounds = (lat?: number | null, lng?: number | null) =>
  lat != null && lng != null && lat <= BOUNDS.north && lat >= BOUNDS.south && lng <= BOUNDS.east && lng >= BOUNDS.west;

/** Drop street addresses, exact pins inside rooms, and operator surnames. */
function scrub(p: Json) {
  const rooms = (p.rooms ?? []).map((r: Json) => {
    const { address, devices: _d, ...rest } = r;
    return { ...rest, address: address ? { city: address.city, state: address.state, zip: address.zip, citySlug: address.citySlug } : null };
  });
  const op = p.primaryOperator;
  return {
    ...p,
    rooms,
    primaryOperator: op ? { id: op.id, firstName: op.firstName ?? null, dateJoined: op.dateJoined ?? null, picture: op.picture ?? null } : null,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const errors: { id: string | null; error: string }[] = [];
  const items: unknown[] = [];
  let status: "done" | "failed" = "done";
  const candidates = new Map<number, string>(); // id -> path
  const seen = new Set<number>();
  let outOfBounds = 0;
  let comingSoon = 0;

  try {
    // 1. Homes sitemap.
    const sm = await get("/sitemap_homes.xml");
    for (const m of sm.body.matchAll(/<loc>https:\/\/www\.padsplit\.com(\/rooms-for-rent\/listing\/ca\/([^/]+)\/[^<]*\/(\d+))<\/loc>/g)) {
      if (SITEMAP_CITIES.has(m[2])) candidates.set(Number(m[3]), m[1]);
    }
    console.log(`sitemap: ${candidates.size} Bay Area-ish CA properties`);

    // 2. City search pages.
    for (const slug of CITY_SLUGS) {
      const { status: st, body } = await get(`/rooms-for-rent/${slug}`);
      if (st !== 200) {
        console.log(`  city ${slug}: ${st}`);
        continue;
      }
      const list = query(nextQueries(body), "properties-list");
      let fresh = 0;
      for (const r of list?.results ?? []) {
        if (!candidates.has(r.id)) fresh++;
        candidates.set(r.id, `/rooms-for-rent/listing/${r.slug ?? r.id}`);
      }
      console.log(`  city ${slug}: ${list?.results?.length ?? 0} results (${fresh} new), count=${list?.count ?? "?"}`);
    }

    // 3. Property pages (+ nearby homes).
    const queue = [...candidates.keys()];
    while (queue.length && items.length < limit) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const path = candidates.get(id) ?? `/rooms-for-rent/listing/${id}`;
      try {
        let qs: Query[] = [];
        let p: Json = null;
        let redirected = false;
        // The property JSON is occasionally missing from the SSR payload; retry with backoff.
        for (let attempt = 1; attempt <= 3 && !p?.id; attempt++) {
          if (attempt > 1) await sleep(4000 * attempt);
          const { status: st, body } = await get(path);
          if (st >= 300 && st < 400) {
            redirected = true;
            console.log(`  - ${id}: redirect (${st}) to ${new URL(path, BASE).pathname === "/" ? "/" : "elsewhere"}; not listed`);
            break;
          }
          if (st !== 200) throw new Error(`HTTP ${st}`);
          qs = nextQueries(body);
          p = query(qs, "property-listing-info");
          if (!p?.id) console.log(`  … ${id}: no property data (attempt ${attempt}, ${body.length} bytes, queries: ${qs.map((q) => q.queryKey[0]).join(",") || "none"})`);
        }
        if (redirected) continue;
        if (!p?.id) throw new Error("no property data");
        for (const n of query(qs, "nearby-homes") ?? []) {
          if (n?.id && !candidates.has(n.id) && n.address?.state === "CA") {
            candidates.set(n.id, `/rooms-for-rent/listing/${n.slug}`);
            queue.push(n.id);
          }
        }
        if (!inBounds(p.lat, p.lng)) {
          outOfBounds++;
          console.log(`  - ${id} ${p.address?.city}: outside bounds`);
          continue;
        }
        // One item per listed room (homes marked "coming soon" have none yet).
        const { rooms, ...property } = scrub(p);
        const meta = {
          ...property,
          url: new URL(`/rooms-for-rent/listing/${p.slug}`, BASE).href,
          scrapedAt: new Date().toISOString(),
          moveIn: query(qs, "available-move-in-dates") ?? null,
          hostStats: query(qs, "HostStats") ?? null,
        };
        const listed = rooms.filter((r: Json) => r.status === 1 && r.detailedStatus === "listed");
        if (!listed.length) comingSoon++;
        for (const room of listed) items.push({ property: meta, room });
        console.log(`  ✓ ${id} ${p.address?.city} (${p.rooms?.length ?? 0} rooms, ${p.listingStatus})`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        errors.push({ id: String(id), error: String(err) });
        console.error(`  ✗ ${id}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  const complete = status === "done" && items.length < limit && !errors.length;
  const file = {
    source: "padsplit",
    market: MARKET,
    startedAt,
    finishedAt: new Date().toISOString(),
    complete,
    propertiesChecked: seen.size,
    outOfBounds,
    propertiesWithoutListedRooms: comingSoon,
    errors,
    items,
  };
  await mkdir("data/scrapes", { recursive: true });
  const out = `data/scrapes/padsplit-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(out, JSON.stringify(file));
  console.log({ path: out, items: items.length, errors: errors.length, complete });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
