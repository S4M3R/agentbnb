// Roomster "rooms for rent" scraper for the SF Bay Area (Node, no browser).
//
//   npx tsx scripts/scrapers/roomster.node.ts [limitListings] [--paginate] [--max=600]
//
// Fetches only public, server-rendered pages:
//   - /rooms-for-rent/<city-slug>   page 1 by default. With --paginate, also follows the
//                                   page's own ?search_params...page_number=N links (which
//                                   robots.txt disallows; opted into for the demo) until every
//                                   page of every slug is read or --max unique rooms are found.
//   - /listings/<id>                public listing page, for the decoded characteristics.
//                                   Listings already in the latest previous scrape file reuse
//                                   its details instead of being re-fetched.
// /api/ and /profile/ are never fetched (county slugs redirect to /rooms-for-rent/s/<slug>,
// which is followed). Sequential, >= 1.2s apart (1.5s with
// --paginate), honest User-Agent; stops on 403/429/challenge.
//
// Personal data is stripped before writing: no last names, birth dates, ages, emails,
// phones, ID-verification records, street numbers; coordinates rounded to 2 decimals;
// phone numbers/emails scrubbed from free text.
//
// Writes data/scrapes/roomster-sf-bay-area-<timestamp>.json.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const BASE = "https://roomster.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const BOUNDS = { n: 38.35, s: 36.95, e: -121.55, w: -123.1 };
const args = process.argv.slice(2);
const PAGINATE = args.includes("--paginate");
const MAX_UNIQUE = Number(args.find((a) => a.startsWith("--max="))?.slice(6) ?? 600);
const DELAY_MS = PAGINATE ? 1500 : 1200;
const MAX_PAGES_PER_SLUG = 30;

const limitArg = args.find((a) => /^\d+$/.test(a));
const limit = limitArg ? Number(limitArg) : Infinity;

// Bay Area slugs from roomster.com's rooms-for-rent sitemap, plus a few common cities not
// in it (404s are skipped). Out-of-bounds results are filtered by coordinates anyway.
const SLUGS = [
  "san-francisco-ca-usa",
  "south-of-market-san-francisco-ca-usa",
  "south-san-francisco-ca-usa",
  "daly-city-ca-usa",
  "san-mateo-ca-usa",
  "san-mateo-county-ca-usa",
  "burlingame-ca-usa",
  "belmont-ca-usa",
  "redwood-city-ca-usa",
  "menlo-park-ca-usa",
  "east-palo-alto-ca-usa",
  "palo-alto-ca-usa",
  "stanford-ca-usa",
  "half-moon-bay-ca-usa",
  "san-bruno-ca-usa",
  "millbrae-ca-usa",
  "foster-city-ca-usa",
  "san-carlos-ca-usa",
  "pacifica-ca-usa",
  "mountain-view-ca-usa",
  "los-altos-ca-usa",
  "sunnyvale-ca-usa",
  "santa-clara-ca-usa",
  "cupertino-ca-usa",
  "san-jose-ca-usa",
  "campbell-ca-usa",
  "los-gatos-ca-usa",
  "saratoga-ca-usa",
  "milpitas-ca-usa",
  "morgan-hill-ca-usa",
  "gilroy-ca-usa",
  "santa-cruz-ca-usa",
  "santa-cruz-county-ca-usa",
  "fremont-ca-usa",
  "newark-ca-usa",
  "union-city-ca-usa",
  "hayward-ca-usa",
  "castro-valley-ca-usa",
  "san-leandro-ca-usa",
  "alameda-ca-usa",
  "oakland-ca-usa",
  "emeryville-ca-usa",
  "berkeley-ca-usa",
  "southside-berkeley-ca-usa",
  "albany-ca-usa",
  "el-cerrito-ca-usa",
  "richmond-ca-usa",
  "san-pablo-ca-usa",
  "pleasanton-ca-usa",
  "dublin-ca-usa",
  "livermore-ca-usa",
  "san-ramon-ca-usa",
  "walnut-creek-ca-usa",
  "concord-ca-usa",
  "pleasant-hill-ca-usa",
  "martinez-ca-usa",
  "pittsburg-ca-usa",
  "antioch-ca-usa",
  "brentwood-ca-usa",
  "vallejo-ca-usa",
  "benicia-ca-usa",
  "american-canyon-ca-usa",
  "fairfield-ca-usa",
  "solano-county-ca-usa",
  "napa-ca-usa",
  "petaluma-ca-usa",
  "novato-ca-usa",
  "san-rafael-ca-usa",
  "mill-valley-ca-usa",
  "marin-county-ca-usa",
  "san-francisco-county-ca-usa",
  "alameda-county-ca-usa",
  "contra-costa-county-ca-usa",
  "santa-clara-county-ca-usa",
  "napa-county-ca-usa",
];

class StopError extends Error {}
class NotFoundError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string, attempt = 1): Promise<string> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * attempt);
      return get(path, attempt + 1);
    }
    throw err;
  }
  const body = await res.text();
  const challenged = /<title>Just a moment|cf_chl_opt|cf-chl-|g-recaptcha|h-captcha/i.test(body);
  if (res.status === 403 || res.status === 429 || challenged) {
    throw new StopError(`${path}: blocked (${res.status}); stopping`);
  }
  if (res.status === 404) throw new NotFoundError(`${path}: 404`);
  if (res.status >= 500 && attempt < 3) {
    await sleep(2000 * attempt);
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return body;
}

/** Concatenate the Next.js RSC flight chunks embedded in the page. */
function flight(html: string) {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      /* skip malformed chunk */
    }
  }
  return out;
}

type RawItem = Record<string, unknown> & {
  id: number;
  listingTypeId?: number;
  geoLocation?: { latitude?: number; longitude?: number };
  location?: Record<string, unknown>;
  user?: Record<string, unknown>;
};

/** The page's own link to page `n` of this search (search_params bbox + page_number). */
function pageUrl(html: string, slug: string, n: number) {
  // County pages redirect to /rooms-for-rent/s/<slug>, so their links carry the /s/ prefix.
  const m = html.match(new RegExp(`href="(/rooms-for-rent/(?:s/)?${slug}\\?[^"]*search_params\\.page_number=)\\d+"`));
  return m ? `${m[1].replace(/&amp;/g, "&")}${n}` : null;
}

/** Details (title/description/characteristics/amenities) from the latest previous scrape file. */
async function previousDetails() {
  const out = new Map<number, Record<string, unknown>>();
  try {
    const files = (await readdir("data/scrapes")).filter((f) => f.startsWith(`roomster-${MARKET}-`)).sort();
    const last = files.at(-1);
    if (!last) return out;
    const prev = JSON.parse(await readFile(`data/scrapes/${last}`, "utf8")) as { items: Record<string, unknown>[] };
    for (const it of prev.items) out.set(it.id as number, it);
    console.log(`reusing details for ${out.size} listings from ${last}`);
  } catch {
    /* no previous file */
  }
  return out;
}

function listingsCollection(html: string): { count: number; items: RawItem[] } | null {
  const f = flight(html);
  const key = '"listingsCollection":';
  const i = f.indexOf(key);
  if (i === -1) return null;
  // Walk the balanced JSON object that follows the key.
  let depth = 0;
  let inStr = false;
  let esc = false;
  const start = i + key.length;
  for (let j = start; j < f.length; j++) {
    const c = f[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(f.slice(start, j + 1));
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const text = (html?: string | null) =>
  decode((html ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** Decoded characteristics ("Residence", "Household", ...) from the public listing page. */
function parseDetail(html: string) {
  // The "not available" i18n string ships on every page, so key off the rendered info block.
  if (!/_listingDetailRoomInfo/.test(html)) return { gone: true as const };
  const sections: Record<string, Record<string, string>> = {};
  let amenities: string[] = [];
  for (const box of html.split(/_listingDetailRoomInfo_box">/).slice(1)) {
    const title = text(box.match(/_infoTitle">([\s\S]*?)<\/p>/)?.[1]);
    if (!title) continue;
    if (/_amenitiesItem/.test(box)) {
      amenities = [...box.matchAll(/_amenitiesItem">([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
      continue;
    }
    const pairs: Record<string, string> = {};
    for (const m of box.matchAll(/_infoListName">([\s\S]*?)<\/p><p>([\s\S]*?)<\/p>/g)) {
      pairs[text(m[1]).replace(/:$/, "")] = text(m[2]);
    }
    sections[title] = pairs;
  }
  // Long strings in the RSC payload are references ("$33"), so read the rendered text.
  const description =
    decode(
      (html.match(/_descriptionText">([\s\S]*?)<\/p>/)?.[1] ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""),
    )
      .replace(/[ \t]+/g, " ")
      .trim() || null;
  const title = text(html.match(/<h1[^>]*_listingDetailed_title[^>]*>([\s\S]*?)<\/h1>/)?.[1]) || null;
  return { gone: false as const, amenities, sections, description, title };
}

const round2 = (n: unknown) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);
const STREET =
  /\b(avenue|ave|street|st|boulevard|blvd|road|rd|drive|dr|way|lane|ln|court|ct|place|pl|terrace|ter|tr|trail|trl|circle|cir|parkway|pkwy|highway|hwy|expressway|expy|freeway|fwy|alley|aly|square|sq|loop|row|commons?|cm|cmn|plaza|plz|path|walk|crest|point|pt|run|bend|pass|grove|grv|glen|gln|crossing|xing|real)\.?$/i;

/** Remove phone numbers (incl. Roomster's "•••"-masked ones) and emails from free text. */
export function scrub(s: unknown) {
  if (typeof s !== "string") return null;
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/\+?\d?[\s(]*\d{3}[\s)•.\-]*(?:[•\s.\-]*\d){7,}/g, "[phone removed]")
    .replace(/(?:\(?\d{3}\)?[\s.\-•]*){1,2}(?:•+[\s.\-]*)+\d{2,4}/g, "[phone removed]")
    .trim();
}

/** Keep only what we need from a listing record, minus personal data. */
function sanitize(item: RawItem) {
  const {
    addressFull: _af,
    addressFormatted,
    geoLocation,
    location,
    user,
    description,
    title,
    isBookmarked: _b,
    missingFields: _m,
    ...rest
  } = item as RawItem & Record<string, unknown>;
  const firstPart = typeof addressFormatted === "string" ? addressFormatted.split(",")[0].trim() : "";
  const city = (location?.city as string | undefined) ?? null;
  const neighborhood = firstPart && firstPart !== city && !STREET.test(firstPart) && !/\d/.test(firstPart) ? firstPart : null;
  const u = user as Record<string, unknown> | undefined;
  const avatar = (u?.avatar as { path?: string } | undefined)?.path;
  const verifications = (u?.verifications ?? {}) as Record<string, unknown>;
  return {
    ...rest,
    title: scrub(title),
    description: scrub(description),
    neighborhood,
    location: {
      city,
      region: location?.region ?? null,
      country: location?.country ?? null,
      postalCode: location?.postalCode ?? null,
    },
    lat: round2(geoLocation?.latitude),
    lng: round2(geoLocation?.longitude),
    user: u
      ? {
          id: u.id,
          firstName: typeof u.firstName === "string" ? u.firstName.trim() : null,
          avatar: avatar && !/placeholders/.test(avatar) ? avatar : null,
          registerDate: u.registerDate ?? null,
          isVerified: u.isVerified ?? null,
          verifiedEmail: verifications.email ?? null,
          verifiedPhone: verifications.phone ?? null,
        }
      : null,
  };
}

const inBounds = (lat: unknown, lng: unknown) =>
  typeof lat === "number" &&
  typeof lng === "number" &&
  lat <= BOUNDS.n &&
  lat >= BOUNDS.s &&
  lng <= BOUNDS.e &&
  lng >= BOUNDS.w;

async function main() {
  const startedAt = new Date().toISOString();
  const errors: { id: string; error: string }[] = [];
  const found = new Map<number, { item: RawItem; slugs: string[] }>();
  const slugCounts: Record<string, number | null> = {};
  const pagination: Record<string, { pages: number; expected: number | null; finished: boolean }> = {};
  let capped = false;
  const cache = await previousDetails();
  let reused = 0;
  const items: unknown[] = [];
  let status: "done" | "failed" = "done";

  try {
    const add = (item: RawItem, slug: string) => {
      // listingTypeId 2 = "haveshare" (room offered in a shared place).
      if (item.listingTypeId !== 2) return false;
      if (!inBounds(item.geoLocation?.latitude, item.geoLocation?.longitude)) return false;
      const prev = found.get(item.id);
      if (prev) {
        if (!prev.slugs.includes(slug)) prev.slugs.push(slug);
      } else {
        if (found.size >= MAX_UNIQUE) {
          capped = true;
          return false;
        }
        found.set(item.id, { item, slugs: [slug] });
      }
      return true;
    };

    for (const slug of SLUGS) {
      if (capped) {
        pagination[slug] = { pages: 0, expected: null, finished: false };
        continue;
      }
      try {
        const html = await get(`/rooms-for-rent/${slug}`);
        const coll = listingsCollection(html);
        slugCounts[slug] = coll?.count ?? null;
        let kept = 0;
        let seen = coll?.items.length ?? 0;
        for (const item of coll?.items ?? []) if (add(item, slug)) kept++;
        const pageSize = coll?.items.length ?? 0;
        const expected = pageSize && coll?.count ? Math.ceil(coll.count / pageSize) : 1;
        let pages = 1;
        let finished = expected <= 1;
        if (PAGINATE && !finished) {
          for (let n = 2; n <= Math.min(expected, MAX_PAGES_PER_SLUG) && !capped; n++) {
            const url = pageUrl(html, slug, n);
            if (!url) break;
            const page = listingsCollection(await get(url));
            pages = n;
            if (!page?.items.length) {
              finished = true; // ran out early: the count overstated what's listable
              break;
            }
            seen += page.items.length;
            for (const item of page.items) if (add(item, slug)) kept++;
            if (n === expected) finished = true;
          }
        }
        if (capped && !finished) console.log(`  cap of ${MAX_UNIQUE} unique rooms reached`);
        pagination[slug] = { pages, expected, finished };
        console.log(`  ${slug}: ${seen}/${coll?.count ?? "?"} over ${pages}/${expected} page(s), ${kept} in bounds`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        if (err instanceof NotFoundError) {
          slugCounts[slug] = null;
          pagination[slug] = { pages: 0, expected: 0, finished: true };
          console.log(`  ${slug}: 404`);
          continue;
        }
        pagination[slug] = { pages: 0, expected: null, finished: false };
        errors.push({ id: slug, error: String(err) });
        console.error(`  ✗ ${slug}: ${err}`);
      }
    }
    console.log(`${found.size} unique Bay Area rooms; fetching listing pages`);

    for (const { item, slugs } of [...found.values()].slice(0, limit)) {
      try {
        const cached = cache.get(item.id);
        if (cached?.characteristics) {
          const clean = sanitize(item);
          items.push({
            ...clean,
            title: cached.title ?? clean.title,
            description: cached.description ?? null,
            searchSlugs: slugs,
            amenityLabels: cached.amenityLabels ?? [],
            characteristics: cached.characteristics,
          });
          reused++;
          continue;
        }
        const detail = parseDetail(await get(`/listings/${item.id}`));
        if (detail.gone) {
          console.log(`  - ${item.id} gone`);
          continue;
        }
        const clean = sanitize(item);
        items.push({
          ...clean,
          title: scrub(detail.title) ?? clean.title,
          description: scrub(detail.description) ?? (/^\$[0-9a-f]+$/.test(clean.description ?? "") ? null : clean.description),
          searchSlugs: slugs,
          amenityLabels: detail.amenities,
          characteristics: detail.sections,
        });
        console.log(`  ✓ ${item.id}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        if (err instanceof NotFoundError) continue;
        errors.push({ id: String(item.id), error: String(err) });
        console.error(`  ✗ ${item.id}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  // Complete only if every page of every slug was read (no cap, no errors, no limit):
  // otherwise unseen listings may still exist, so they must not be marked gone.
  const complete =
    PAGINATE &&
    status === "done" &&
    !capped &&
    errors.length === 0 &&
    limit === Infinity &&
    SLUGS.every((s) => pagination[s]?.finished);
  const file = {
    source: "roomster",
    market: MARKET,
    startedAt,
    finishedAt: new Date().toISOString(),
    complete,
    status,
    slugCounts,
    pagination,
    capped,
    errors,
    items,
  };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/roomster-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log({ path, unique: found.size, items: items.length, reused, errors: errors.length, capped, complete, status });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
