// Zumper scraper: rooms for rent (rooms in shared homes) around the SF Bay Area.
// PadMapper is the same company and inventory, so this covers both under one source id.
//
//   npx tsx scripts/scrapers/zumper.node.ts [limit]
//
// Uses the JSON endpoints Zumper's own web app calls: the room search
// (POST /api/t/1/pages/listables with propertyCategories=["room"] and a bounding box; the
// whole market plus smaller tiles, de-duplicated) and each listing's detail
// (GET /api/t/1/pages/listings/:id). No login, no tokens. Phones, emails, agent records
// and house numbers are stripped before writing. Sequential, >= 1.5s between requests,
// honest User-Agent; stops on 403/429 or any bot challenge.
// Writes data/scrapes/zumper-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

// Untyped third-party JSON payloads.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const BASE = "https://www.zumper.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const DELAY_MS = 1500;
const CAP = 300;
const PAGE = 50;
// [minLat, maxLat, minLng, maxLng]: the market bounds, then tiles in case a big box truncates.
const BOXES: [number, number, number, number][] = [
  [36.95, 38.35, -123.1, -121.55],
  [37.7, 37.84, -122.53, -122.35], // San Francisco
  [37.45, 37.7, -122.53, -122.1], // Peninsula
  [37.7, 38.0, -122.35, -121.9], // East Bay (Oakland, Berkeley, Richmond)
  [37.45, 37.7, -122.1, -121.7], // Fremont / Hayward / Tri-Valley
  [37.15, 37.45, -122.2, -121.7], // South Bay (San Jose)
  [37.84, 38.35, -123.1, -122.35], // North Bay
  [38.0, 38.35, -122.35, -121.55], // Solano / NE Contra Costa
  [36.95, 37.15, -122.3, -121.55], // Santa Cruz / Gilroy
];

const limit = process.argv[2] ? Number(process.argv[2]) : CAP;

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function request(path: string, body?: unknown, attempt = 1): Promise<Json> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetch(new URL(path, BASE), {
      method: body ? "POST" : "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (attempt < 4) {
      await sleep(2000 * attempt);
      return request(path, body, attempt + 1);
    }
    throw err;
  }
  const text = await res.text();
  if (res.status === 403 || res.status === 429 || /<title>Just a moment|cf_chl_opt|captcha/i.test(text)) {
    throw new StopError(`${path}: blocked (${res.status})`);
  }
  if (res.status >= 500 && attempt < 4) {
    await sleep(3000 * attempt);
    return request(path, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(\s*ext\.?\s*\d+)?/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const clean = (s: unknown) => (typeof s === "string" ? s.replace(PHONE, "[phone removed]").replace(EMAIL, "[email removed]") : s);
/** Drop the house number from "2867 22nd Street" → "22nd Street". */
const streetOnly = (s: unknown) => (typeof s === "string" ? s.replace(/^\s*\d+[A-Za-z]?(-\d+)?\s+/, "").replace(/\s*#.*$/, "") : s);

/** Strip phones, emails and house numbers from every string; drop address-slug URL fields. */
const STREET = "(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ct|Court|Way|Ln|Lane|Ter|Terrace|Cir|Circle|Pl|Place|Pkwy|Hwy)";
const HOUSE_NUMBER = new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+((?:[A-Z0-9][\\w.'-]*\\s+){1,4}${STREET})\\b\\.?`, "g");
const DROP_KEYS = new Set(["pa_url", "pl_url", "padmapper_url", "provider_url", "phone", "listing_agents", "email"]);
function deepScrub(v: unknown): unknown {
  if (typeof v === "string") return (clean(v) as string).replace(HOUSE_NUMBER, "$1");
  if (Array.isArray(v)) return v.map(deepScrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP_KEYS.has(k)).map(([k, x]) => [k, deepScrub(x)]));
  }
  return v;
}

function scrubListable(l: Json) {
  const { phone: _p, agent_id: _a, agent_name: _n, provider_url: _u, ...rest } = l;
  return { ...rest, address: streetOnly(l.address), title: clean(l.title), short_description: clean(l.short_description) };
}

function scrubDetail(d: Json) {
  const { phone: _p, listing_agents: agents, similar: _s, provider_url: _u, ...rest } = d;
  const loc = d.listing_location ?? {};
  return {
    ...rest,
    title: clean(d.title),
    description: clean(d.description),
    short_description: clean(d.short_description),
    address: streetOnly(d.address),
    listing_location: {
      street: loc.street ?? null,
      neighborhood_id: loc.neighborhood_id ?? null,
      zipcode: loc.zipcode ?? null,
      city: loc.city ?? null,
      state: loc.state ?? null,
      lat: loc.lat ?? null,
      lng: loc.lng ?? null,
      hasHouseNumber: Boolean(loc.house),
    },
    // Agent records carry names, phones and emails; keep only an id + the display name's
    // first word (often a company, e.g. "Vybe") and whether fees apply.
    operator: agents?.[0]
      ? {
          id: agents[0].user_id ?? null,
          name: String(agents[0].long_name ?? agents[0].first_name ?? "").split(/\s+/)[0] || null,
          applicationFee: agents[0].application_fee ?? null,
          screeningFee: agents[0].screening_fee ?? null,
        }
      : null,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const errors: { id: string | null; error: string }[] = [];
  const items: unknown[] = [];
  let status: "done" | "failed" = "done";
  const found = new Map<number, Json>();

  try {
    for (const [minLat, maxLat, minLng, maxLng] of BOXES) {
      for (let offset = 0; ; offset += PAGE) {
        const d = await request("/api/t/1/pages/listables", {
          propertyCategories: ["room"],
          minLat, maxLat, minLng, maxLng,
          limit: PAGE,
          offset,
        });
        const list: Json[] = d?.listables ?? [];
        let fresh = 0;
        for (const l of list) {
          if (l?.listing_id && !found.has(l.listing_id)) {
            found.set(l.listing_id, l);
            fresh++;
          }
        }
        console.log(`box ${[minLat, maxLat, minLng, maxLng].join(",")} @${offset}: ${list.length} (${fresh} new), matching=${d?.matching}`);
        if (list.length < PAGE || offset + PAGE >= (d?.matching ?? 0) || found.size >= limit) break;
      }
      if (found.size >= limit) break;
    }
    console.log(`${found.size} room listings`);

    for (const l of [...found.values()].slice(0, limit)) {
      try {
        const detail = await request(`/api/t/1/pages/listings/${l.listing_id}`);
        items.push({
          listable: deepScrub(scrubListable(l)),
          detail: deepScrub(scrubDetail(detail)),
          url: new URL(l.url, BASE).href,
          scrapedAt: new Date().toISOString(),
        });
        console.log(`  ✓ ${l.listing_id} ${l.city} $${l.min_price} (${l.feed_name ?? "direct"})`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        errors.push({ id: String(l.listing_id), error: String(err) });
        console.error(`  ✗ ${l.listing_id}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  const complete = status === "done" && found.size < limit && !errors.length;
  const file = { source: "zumper", market: MARKET, startedAt, finishedAt: new Date().toISOString(), complete, errors, items };
  await mkdir("data/scrapes", { recursive: true });
  const out = `data/scrapes/zumper-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(out, JSON.stringify(file));
  console.log({ path: out, items: items.length, errors: errors.length, complete });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
