// Roomi (roomiapp.com) rooms for rent in the SF Bay Area (Node, no browser).
//
//   npx tsx scripts/scrapers/roomi.node.ts [maxListings=200]
//
// Public, server-rendered pages only (no login, no /api/):
//   - /sitemap.xml                      to discover Bay Area location and listing slugs.
//   - /rooms-for-rent/<location-slug>   location page; embeds that location's listings.
//   - /room-rental/<listing-slug>       public listing page; embeds the listing, its resolved
//                                       amenity names and other listings in the same location.
// robots.txt disallows /listings/ (opted into for the demo; that path isn't even needed, the
// public pages above carry the data). Sequential, >= 1.5s apart, honest User-Agent; stops on
// 403/429/challenge.
//
// Personal data is stripped before writing: no last names, gender, ages, emails, phones,
// street addresses; coordinates rounded to 2 decimals; emails/phones scrubbed from text.
//
// Writes data/scrapes/roomi-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://roomiapp.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const BOUNDS = { n: 38.35, s: 36.95, e: -121.55, w: -123.1 };
const DELAY_MS = 1500;
const MAX = process.argv[2] ? Number(process.argv[2]) : 200;

/** Location slugs Roomi files under the Bay Area (most end in "-san-francisco-california"). */
const BAY =
  /(san-francisco|oakland|berkeley|san-jose|palo-alto|mountain-view|santa-clara|sunnyvale|cupertino|fremont|hayward|daly-city|san-mateo|redwood-city|alameda|walnut-creek|concord|richmond|marin|napa|santa-cruz|danville|pleasanton|milpitas|emeryville|burlingame|menlo-park|livermore|dublin|san-ramon|vallejo|san-leandro|union-city|newark|campbell|los-gatos|saratoga|san-rafael|novato|petaluma|south-san-francisco|san-bruno|millbrae|foster-city|belmont|san-carlos|pacifica|half-moon-bay|los-altos|morgan-hill|gilroy|albany|el-cerrito|martinez|pittsburg|antioch|benicia|fairfield)-.*california$/;
const NOT_BAY = /los-angeles|san-diego|sacramento/;

class StopError extends Error {}
class NotFoundError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
let blocked = 0;

async function get(path: string, attempt = 1): Promise<string> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    if (attempt >= 3) throw err;
    await sleep(2000 * 2 ** attempt);
    return get(path, attempt + 1);
  }
  const body = await res.text();
  const challenged = /<title>Just a moment|cf_chl_opt|cf-chl-|g-recaptcha|h-captcha|px-captcha|captcha-delivery/i.test(body);
  if (res.status === 403 || res.status === 429 || challenged) {
    if (++blocked >= 2 || attempt >= 2) throw new StopError(`${path}: blocked (${res.status}); stopping`);
    await sleep(10_000);
    return get(path, attempt + 1);
  }
  if (res.status === 404) throw new NotFoundError(`${path}: 404`);
  if (res.status >= 500 && attempt < 3) {
    await sleep(2000 * 2 ** attempt);
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

/** Parse the balanced JSON value (object or array) starting at `start`. */
function balanced(f: string, start: number): unknown {
  const open = f[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < f.length; j++) {
    const c = f[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(f.slice(start, j + 1));
  }
  return null;
}

function valueAfter(f: string, key: string) {
  const i = f.indexOf(key);
  if (i === -1) return null;
  try {
    return balanced(f, i + key.length);
  } catch {
    return null;
  }
}

type Obj = Record<string, unknown>;
type RawListing = Obj & { id: string; slug: string; latitude?: number; longitude?: number; user?: unknown };

/** Remove emails and phone numbers from free text. */
function scrub(s: unknown) {
  if (typeof s !== "string") return null;
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/\+?1?[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{4}\b/g, "[phone removed]")
    .trim();
}

const round2 = (n: unknown) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);
const inBounds = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && lat <= BOUNDS.n && lat >= BOUNDS.s && lng <= BOUNDS.e && lng >= BOUNDS.w;

/** City from "959 Main St, Mountain View, CA 94040, USA" or "Mountain View, California". */
function cityOf(l: RawListing) {
  const display = typeof l.display_location === "string" ? l.display_location : "";
  const city = display.split(",")[0]?.trim();
  return city || null;
}

function sanitize(l: RawListing, amenityNames: Record<string, string>) {
  const profile = ((l.user as Obj | undefined)?.profile ?? {}) as Obj;
  const firstName = typeof profile.first_name === "string" ? profile.first_name.trim() : "";
  const zip = typeof l.location === "string" ? (l.location.match(/\b(9\d{4})\b/)?.[1] ?? null) : null;
  const amenityIds = (Array.isArray(l.amenities) ? l.amenities : []) as string[];
  return {
    id: l.id,
    slug: l.slug,
    status: l.status ?? null,
    archivedAt: l.archived_at ?? null,
    snoozedAt: l.snoozed_at ?? null,
    pricePerMonth: l.price_per_month ?? null,
    securityDeposit: l.security_deposit ?? null,
    roomType: l.room_type ?? null,
    propertyType: l.property_type ?? null,
    bedrooms: l.bedrooms ?? null,
    bathrooms: l.bathrooms ?? null,
    availabilityDate: l.availability_date ?? null,
    moveOutDate: l.move_out_date ?? null,
    leaseDuration: l.lease_duration ?? null,
    roommateCount: l.roommate_count ?? null,
    roommateAgeRange: [l.roommate_min_age ?? null, l.roommate_max_age ?? null],
    situation: l.situation ?? null,
    description: scrub(l.description),
    city: cityOf(l),
    neighborhood: typeof l.neighborhood === "string" ? l.neighborhood : null,
    locationSlug: l.location_slug ?? null,
    postalCode: zip,
    lat: round2(l.latitude),
    lng: round2(l.longitude),
    photos: (Array.isArray(l.photos) ? l.photos : []).filter((p): p is string => typeof p === "string"),
    amenityIds,
    amenities: amenityIds.map((id) => amenityNames[id]).filter(Boolean),
    publishedAt: l.published_at ?? null,
    updatedAt: l.updated_at ?? null,
    host: l.user_id
      ? {
          id: l.user_id,
          firstName: firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : null,
          avatar: typeof profile.profile_photo_url === "string" ? profile.profile_photo_url : null,
          memberSince: profile.created_at ?? null,
          badges: Array.isArray(profile.badges) ? profile.badges : [],
        }
      : null,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const errors: { id: string; error: string }[] = [];
  const notes: string[] = [];
  let status: "done" | "failed" = "done";
  const found = new Map<string, RawListing>(); // by listing id
  const detailed = new Set<string>(); // slugs whose /room-rental page was read
  const amenityNames: Record<string, string> = {};
  let capped = false;

  const collect = (l: unknown) => {
    const x = l as RawListing;
    if (!x?.id || !x.slug) return;
    if (!inBounds(x.latitude, x.longitude)) return;
    const prev = found.get(x.id);
    if (!prev && found.size >= MAX) {
      capped = true;
      return;
    }
    // Keep the richest copy (detail pages embed `user` with the profile).
    const userOf = (v?: RawListing) => (v?.user && typeof v.user === "object" ? v.user : undefined);
    found.set(x.id, { ...prev, ...x, user: userOf(x) ?? userOf(prev) });
  };
  const learnAmenities = (f: string) => {
    for (const m of f.matchAll(/"id":"(amenity-[\w-]+)","name":"((?:[^"\\]|\\.)*)"/g)) amenityNames[m[1]] = JSON.parse(`"${m[2]}"`);
  };

  try {
    const sitemap = await get("/sitemap.xml");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    const locationSlugs = locs
      .filter((p) => p.startsWith("/rooms-for-rent/"))
      .map((p) => p.slice("/rooms-for-rent/".length))
      .filter((s) => (BAY.test(s) || s === "san-francisco-california") && !NOT_BAY.test(s));
    const listingSlugs = new Set(
      locs
        .filter((p) => p.startsWith("/room-rental/"))
        .map((p) => p.slice("/room-rental/".length))
        .filter((s) => BAY.test(s.replace(/-\d+$/, "")) && !NOT_BAY.test(s)),
    );
    console.log(`${locationSlugs.length} Bay Area location pages, ${listingSlugs.size} listing pages in sitemap`);

    for (const slug of locationSlugs) {
      try {
        const f = flight(await get(`/rooms-for-rent/${slug}`));
        learnAmenities(f);
        const list = (valueAfter(f, '{"listings":') ?? []) as RawListing[];
        for (const l of list) {
          collect(l);
          if (l.slug) listingSlugs.add(l.slug);
        }
        console.log(`  ${slug}: ${list.length} listings`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        if (err instanceof NotFoundError) continue;
        errors.push({ id: slug, error: String(err) });
      }
    }

    // Listing pages; each also embeds other listings in its location, which are queued too.
    const queue = [...listingSlugs];
    while (queue.length) {
      const slug = queue.shift()!;
      if (detailed.has(slug)) continue;
      detailed.add(slug);
      try {
        const f = flight(await get(`/room-rental/${slug}`));
        learnAmenities(f);
        const listing = valueAfter(f, '{"listing":') as RawListing | null;
        if (listing) collect(listing);
        const others = (valueAfter(f, '"listingsByLocation":') ?? []) as RawListing[];
        for (const o of others) {
          collect(o);
          if (o.slug && !detailed.has(o.slug) && inBounds(o.latitude, o.longitude)) queue.push(o.slug);
        }
        console.log(`  ✓ ${slug}${listing ? "" : " (no listing)"} +${others.length} nearby`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        if (err instanceof NotFoundError) {
          console.log(`  - ${slug} 404`);
          continue;
        }
        errors.push({ id: slug, error: String(err) });
        console.error(`  ✗ ${slug}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    notes.push(String(err instanceof Error ? err.message : err));
    console.error(String(err));
  }

  const items = [...found.values()].map((l) => sanitize(l, amenityNames));
  const complete = status === "done" && !capped && errors.length === 0;
  const file = {
    source: "roomi",
    market: MARKET,
    startedAt,
    finishedAt: new Date().toISOString(),
    complete,
    status,
    capped,
    notes,
    errors,
    items,
  };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/roomi-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file, null, 2));
  console.log({ path, items: items.length, errors: errors.length, capped, complete, status });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
