// Apartment List scraper: a small sample of the cheapest studio apartments in San Francisco.
// Apartment List has no rooms-in-shared-homes inventory (its /rooms-for-rent page renders no
// listings), so per the assignment this takes <= 100 of the cheapest SF studios as whole places.
//
//   npx tsx scripts/scrapers/apartmentlist.node.ts [limit]
//
// Reads the React Server Component payload (self.__next_f) embedded in the public, server-
// rendered pages: the SF studio search (/ca/san-francisco/c/studio-apartments-for-rent[/page-N])
// for building ids, studio prices and slugs, then each building page for units, fees, amenities
// and photos. Phones, emails and contact/agent names are dropped before writing. Sequential,
// >= 1.5s between requests, honest User-Agent; stops on 403/429 or any bot challenge.
// Writes data/scrapes/apartmentlist-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

// Untyped third-party JSON payloads.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const BASE = "https://www.apartmentlist.com";
const SEARCH = "/ca/san-francisco/c/studio-apartments-for-rent";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const DELAY_MS = 1500;
const CAP = 100;
const MAX_PAGES = 10;

const limit = Math.min(process.argv[2] ? Number(process.argv[2]) : CAP, CAP);

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string, attempt = 1): Promise<{ status: number; body: string }> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT }, redirect: "manual" });
  } catch (err) {
    if (attempt < 4) {
      await sleep(2000 * attempt);
      return get(path, attempt + 1);
    }
    throw err;
  }
  const body = await res.text();
  if (res.status === 403 || res.status === 429 || /<title>Just a moment|cf_chl_opt|g-recaptcha|h-captcha|captcha-delivery|px-captcha/i.test(body)) {
    throw new StopError(`${path}: blocked (${res.status})`);
  }
  if (res.status >= 500 && attempt < 4) {
    await sleep(3000 * attempt);
    return get(path, attempt + 1);
  }
  return { status: res.status, body };
}

/** Concatenate the RSC flight chunks pushed via self.__next_f.push([1, "..."]). */
function flight(html: string) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((m) => JSON.parse(`"${m[1]}"`) as string)
    .join("");
}

/** Parse the balanced JSON value (object/array) starting at index i. */
function balanced(s: string, i: number): Json {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) break;
    } else if (c === '"') {
      j++;
      while (s[j] !== '"') {
        if (s[j] === "\\") j++;
        j++;
      }
    }
  }
  return JSON.parse(s.slice(i, j + 1));
}

function valueAfter(s: string, marker: string, from = 0) {
  const i = s.indexOf(marker, from);
  return i < 0 ? null : balanced(s, i + marker.length);
}

type SearchHit = { rental_id: string; lat: number; lon: number; prices?: Record<string, number> };

const CONTACT_KEYS = [
  "email", "phone", "original_phone", "office_phone", "contact_name", "agent_name", "listing_agent_name",
  "is_phone_submission_only", "click_url", "contact_logic", "contact_volume_threshold", "contact_volume_multiplier",
  "allow_call_transfer", "broker_license_number", "office_hours_this_week", "available_tour_times",
  "disclaimers", "local_ordinances",
];
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const clean = (v: unknown) => (typeof v === "string" ? v.replace(PHONE, "[phone removed]").replace(EMAIL, "[email removed]") : v);

function scrubBuilding(o: Json) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (CONTACT_KEYS.includes(k) || /disclaimers$/.test(k)) continue;
    out[k] = clean(v);
  }
  return out;
}

async function main() {
  const startedAt = new Date().toISOString();
  const errors: { id: string | null; error: string }[] = [];
  const items: unknown[] = [];
  let status: "done" | "failed" = "done";
  let totalCount: number | null = null;
  const hits = new Map<string, SearchHit>();
  const slugs = new Map<string, string>();

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { status: st, body } = await get(page === 1 ? SEARCH : `${SEARCH}/page-${page}`);
      if (st !== 200) {
        console.log(`page ${page}: HTTP ${st}; stopping pagination`);
        break;
      }
      const f = flight(body);
      const initial = valueAfter(f, '"initialResults":');
      totalCount ??= initial?.total_count ?? null;
      for (const l of (initial?.listings ?? []) as SearchHit[]) hits.set(l.rental_id, l);
      let fresh = 0;
      for (const m of f.matchAll(/"rental_id":"(p\d+)","slug":"(\/ca\/[^"]+)"/g)) {
        if (!slugs.has(m[1])) fresh++;
        slugs.set(m[1], m[2]);
      }
      console.log(`page ${page}: ${initial?.listings?.length ?? 0} buildings in payload, ${fresh} new slugs (${slugs.size}/${totalCount ?? "?"})`);
      if (!fresh || (totalCount != null && slugs.size >= totalCount)) break;
    }

    const studios = [...hits.values()]
      .filter((h) => h.prices?.["0"] && h.prices["0"] > 0 && slugs.has(h.rental_id))
      .sort((a, b) => a.prices!["0"] - b.prices!["0"])
      .slice(0, limit);
    console.log(`${studios.length} cheapest studio buildings (of ${hits.size}); $${studios[0]?.prices?.["0"]}–$${studios.at(-1)?.prices?.["0"]}`);

    for (const h of studios) {
      const slug = slugs.get(h.rental_id)!;
      try {
        const { status: st, body } = await get(slug);
        if (st !== 200) throw new Error(`HTTP ${st}`);
        const f = flight(body);
        // The full building record is the object that carries "available_units".
        const au = f.indexOf('"available_units":');
        const start = au >= 0 ? f.lastIndexOf(`{"rental_id":"${h.rental_id}"`, au) : -1;
        if (start < 0) throw new Error("no building record");
        const building = balanced(f, start);
        const unitsMarker = f.indexOf('"units":[{"unit_id"');
        const unitSummary = unitsMarker >= 0 ? balanced(f, unitsMarker + '"units":'.length) : [];
        const priceRange = valueAfter(f, '"byBedCount":');
        const soonest = f.match(/"soonestAvailable":"([\d-]+)"/)?.[1] ?? null;
        items.push({
          searchStudioPrice: h.prices?.["0"] ?? null,
          searchPrices: h.prices ?? null,
          building: scrubBuilding(building),
          units: unitSummary,
          byBedCount: priceRange,
          soonestAvailable: soonest,
          url: new URL(slug, BASE).href,
          scrapedAt: new Date().toISOString(),
        });
        console.log(`  ✓ ${h.rental_id} ${slug} studio from $${h.prices?.["0"]}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        errors.push({ id: h.rental_id, error: String(err) });
        console.error(`  ✗ ${h.rental_id}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  // A capped sample of the cheapest studios, never the whole inventory.
  const file = {
    source: "apartmentlist",
    market: MARKET,
    startedAt,
    finishedAt: new Date().toISOString(),
    complete: false,
    status,
    sample: "cheapest San Francisco studios",
    totalStudioBuildings: totalCount,
    errors,
    items,
  };
  await mkdir("data/scrapes", { recursive: true });
  const out = `data/scrapes/apartmentlist-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(out, JSON.stringify(file));
  console.log({ path: out, items: items.length, errors: errors.length });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
