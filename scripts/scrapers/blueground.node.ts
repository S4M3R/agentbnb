// Blueground furnished apartments in the SF Bay Area (city code SFO).
//
//   npx tsx scripts/scrapers/blueground.node.ts [maxPages]
//
// 1. Pages through the public, server-rendered city page (?page=N, 18 homes
//    each), reading the listing data embedded as window.__INITIAL_STATE__.
// 2. Without dates the site shows "Add dates to see prices", so prices come
//    from the same public JSON endpoint the page calls (/api/sp, allowed by
//    robots.txt), asked for a 12-month stay from each home's earliest start
//    (Blueground's lowest monthly rate; stored as a "from" price). Homes are
//    batched by start date to keep the request count low.
//
// Cloudflare rate-limits bursts (error 1015), so requests are sequential and
// >= 3s apart; any 403/429/1015/challenge stops the run (partial file written).
// Writes data/scrapes/blueground-<market>-<ts>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.theblueground.com";
const CITY_PATH = "/furnished-apartments-san-francisco-bay-area-usa";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const BOUNDS = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 };
const DELAY_MS = 3000;
const BATCH = 18;

const maxPages = process.argv[2] ? Number(process.argv[2]) : Infinity;

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string, accept: string, attempt = 1): Promise<string> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT, Accept: accept } });
  const body = await res.text();
  if (res.status === 403 || res.status === 429 || /Error 1015|You are being rate limited|<title>Just a moment|cf_chl_opt/i.test(body)) {
    throw new StopError(`${path.slice(0, 120)}: blocked/rate-limited (${res.status}); stopping`);
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(5000 * attempt);
    return get(path, accept, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path.slice(0, 120)}: ${res.status}`);
  return body;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function initialState(html: string): Json {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*/);
  if (!m || m.index == null) throw new Error("no __INITIAL_STATE__");
  const s = html.slice(m.index + m[0].length);
  // The object is followed by ";</script>" or ";window..."; find the matching close brace.
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(0, i + 1));
  }
  throw new Error("unterminated __INITIAL_STATE__");
}

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const inBounds = (lat?: number, lng?: number) =>
  lat != null && lng != null && lat <= BOUNDS.north && lat >= BOUNDS.south && lng <= BOUNDS.east && lng >= BOUNDS.west;

async function main() {
  const startedAt = new Date().toISOString();
  const homes = new Map<number, Json>();
  let status: "done" | "failed" = "done";
  let total = 0;
  let placeId = "";
  let marketCode = "SFO";
  let priced = 0;

  try {
    for (let page = 1; page <= maxPages; page++) {
      const state = initialState(await get(page === 1 ? CITY_PATH : `${CITY_PATH}?page=${page}`, "text/html"));
      placeId ||= state.configuration?.initialData?.location?.placeId ?? "";
      marketCode = state.configuration?.initialData?.location?.marketCode ?? marketCode;
      total = state.properties?.meta?.totalItems ?? total;
      const main: Json[] = state.properties?.allProperties?.main ?? [];
      for (const p of main) homes.set(p.id, p);
      console.log(`  page ${page}: ${main.length} homes (${homes.size}/${total})`);
      if (!main.length || homes.size >= total) break;
    }

    // Price pass: one /api/sp call per (start date, batch of <= 18 ids).
    const byStart = new Map<string, number[]>();
    const today = new Date().toISOString().slice(0, 10);
    for (const p of homes.values()) {
      const start = [p.rent?.minDuration?.start, p.availableFrom, today].filter(Boolean).sort().at(-1) as string;
      byStart.set(start, [...(byStart.get(start) ?? []), p.id]);
    }
    console.log(`  pricing ${homes.size} homes in ${byStart.size} start-date groups`);
    for (const [start, ids] of [...byStart.entries()].sort()) {
      for (let i = 0; i < ids.length; i += BATCH) {
        const params = new URLSearchParams({
          ids: ids.slice(i, i + BATCH).join(","),
          currency: "USD",
          placeId,
          marketCode,
          checkIn: start,
          checkOut: addMonths(start, 12),
        });
        const res = JSON.parse(await get(`/api/sp?${params}`, "application/json"));
        for (const q of (res.properties?.main ?? []) as Json[]) {
          const home = homes.get(q.id);
          if (home && q.rent?.amount) {
            home.quote = { checkIn: start, checkOut: addMonths(start, 12), rent: q.rent, baseRent: q.baseRent };
            priced++;
          }
        }
      }
    }
    console.log(`  priced ${priced}/${homes.size} for 12-month stays`);

    // Homes not open for a full year: price their minimum-duration stay instead.
    const byWindow = new Map<string, number[]>();
    for (const p of homes.values()) {
      const end = p.rent?.minDuration?.end;
      if (p.quote || !end) continue;
      const start = [p.rent?.minDuration?.start, p.availableFrom, today].filter(Boolean).sort().at(-1) as string;
      if (end <= start) continue;
      const key = `${start}|${end}`;
      byWindow.set(key, [...(byWindow.get(key) ?? []), p.id]);
    }
    for (const [key, ids] of [...byWindow.entries()].sort()) {
      const [start, end] = key.split("|");
      for (let i = 0; i < ids.length; i += BATCH) {
        const params = new URLSearchParams({
          ids: ids.slice(i, i + BATCH).join(","),
          currency: "USD",
          placeId,
          marketCode,
          checkIn: start,
          checkOut: end,
        });
        const res = JSON.parse(await get(`/api/sp?${params}`, "application/json"));
        for (const q of (res.properties?.main ?? []) as Json[]) {
          const home = homes.get(q.id);
          if (home && q.rent?.amount) {
            home.quote = { checkIn: start, checkOut: end, rent: q.rent, baseRent: q.baseRent, minStayQuote: true };
            priced++;
          }
        }
      }
    }
    console.log(`  priced ${priced}/${homes.size} total`);
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  const items = [...homes.values()]
    .filter((p) => inBounds(p.address?.lat, p.address?.lng))
    .map(({ ranking: _ranking, ...p }) => p);
  const complete = status === "done" && maxPages === Infinity && homes.size >= total;
  const file = { source: "blueground", market: MARKET, startedAt, finishedAt: new Date().toISOString(), complete, items };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/blueground-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log({ path, items: items.length, priced, total, complete });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
