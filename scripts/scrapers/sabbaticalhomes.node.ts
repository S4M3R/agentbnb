// SabbaticalHomes furnished home rentals (mostly academic sublets) in the SF Bay Area.
//
//   npx tsx scripts/scrapers/sabbaticalhomes.node.ts [limit]
//
// Fetches the public, server-rendered "homes to rent in <city>" landing pages
// (listed in the site's sitemap) for Bay Area cities, then each public
// /rental/<id> detail page. robots.txt only disallows /search (never touched)
// and asks for Crawl-delay: 2, so requests are sequential and >= 2.5s apart.
// Stops on 403/429 or a bot challenge. Only rentals are scraped (exchanges
// are left out). Writes data/scrapes/sabbaticalhomes-<market>-<ts>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.sabbaticalhomes.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const BOUNDS = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 };
const DELAY_MS = 2500;

// Each landing page lists rentals "in or near" the city; a handful covers the region.
const CITY_PAGES = [
  "san-francisco",
  "berkeley",
  "oakland",
  "palo-alto",
  "stanford",
  "menlo-park",
  "mountain-view",
  "sunnyvale",
  "santa-cruz",
  "san-rafael",
  "mill-valley",
  "walnut-creek",
];

const limit = process.argv[2] ? Number(process.argv[2]) : Infinity;

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string, attempt = 1): Promise<string | null> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT } });
  if (res.status === 403 || res.status === 429) throw new StopError(`${path}: blocked (${res.status}); stopping`);
  if (res.status === 404) return null;
  const body = await res.text();
  if (/<title>(Just a moment|Attention Required)|cf_chl_opt|cf-chl-/i.test(body)) {
    throw new StopError(`${path}: bot challenge; stopping`);
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(3000 * attempt);
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return body;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** HTML -> trimmed non-empty text lines. */
function lines(html: string) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Value lines after `label` up to the next known label. */
function after(ls: string[], label: string, stops: string[], from = 0) {
  const i = ls.indexOf(label, from);
  if (i === -1) return [];
  const out: string[] = [];
  for (let j = i + 1; j < ls.length && !stops.includes(ls[j]); j++) out.push(ls[j]);
  return out;
}

const SECTION_LABELS = [
  "Bedrooms",
  "Bathrooms",
  "Offices",
  "Size",
  "Suited For",
  "Property Type",
  "Availability",
  "Minimum Stay",
  "Location",
  "Closest University",
  "Nearby Universities",
  "Neighborhood",
  "Nearby Cities",
  "Comments:",
  "Explore the Area",
  "Surroundings",
  "Rental Rates and Terms",
  "Considerations",
  "Features",
  "Reviews",
];
const FEATURE_GROUPS = ["Interior", "Connectivity", "Temperature Control", "Appliances", "Exterior", "Accessibility", "Parking", "Kitchen", "Outdoor", "Entertainment", "Laundry"];

function parseDetail(id: string, html: string) {
  const main = html.slice(html.indexOf('class="info-card-container"') > 0 ? html.indexOf('class="info-card-container"') : 0);
  const ls = lines(main);
  const badgeAt = Math.max(0, html.lastIndexOf("<", html.indexOf("listing-detail-badge")));
  const top = lines(html.slice(badgeAt, badgeAt + 15000));

  let ld: Record<string, unknown> | null = null;
  const ldm = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ldm) {
    try {
      ld = JSON.parse(ldm[1]);
    } catch {
      ld = null;
    }
  }

  // Header block: BADGE, title, "City, State, Country", "Rates from USD $X", "|", "Monthly", "House", "|", "Entire Home", ...
  // Badge: "HOME RENTAL", "PRIVATE SPACE FOR RENT", "HOME EXCHANGE", ...
  const b = top.findIndex((l) => /^[A-Z][A-Z &/-]{4,}$/.test(l));
  const header = b >= 0 ? top.slice(b, b + 20) : [];
  const priceIdx = header.findIndex((l) => /^Rates from /.test(l));
  const priceLine = priceIdx >= 0 ? header[priceIdx] : null;
  const pricePeriod = priceIdx >= 0 ? header.slice(priceIdx + 1).find((l) => l !== "|") ?? null : null;
  // After the price: period, property type, space type ("Monthly", "House", "Entire Home").
  const afterPrice = priceIdx >= 0 ? header.slice(priceIdx + 1).filter((l) => l !== "|").slice(1) : [];
  const lat = Number(html.match(/value="(-?\d+(?:\.\d+)?)" id="map-lat"/)?.[1]);
  const lng = Number(html.match(/value="(-?\d+(?:\.\d+)?)" id="map-lng"/)?.[1]);

  // Section labels also appear in the anchor bar above; search after the facts table.
  const from = Math.max(0, ls.indexOf("Bedrooms"));
  const sec = (label: string) => after(ls, label, SECTION_LABELS, from);
  const surroundings = sec("Surroundings");
  const rates = sec("Rental Rates and Terms").join(" ");
  const considerations = sec("Considerations").join(" ").replace(/\s+/g, " ");
  const featureLines = sec("Features");
  const features: Record<string, string[]> = {};
  let group = "Other";
  for (const l of featureLines) {
    if (FEATURE_GROUPS.includes(l)) group = l;
    else (features[group] ??= []).push(l);
  }
  const photos = [
    ...new Set(
      [...html.matchAll(/https:\/\/www\.sabbaticalhomes\.com\/user-asset\/[^"' )]+\/listing\/\d+\/[^"' )]+/g)]
        .map((m) => m[0])
        .filter((u) => !/_sm\.\w+$/.test(u)),
    ),
  ];
  const first = (label: string) => sec(label)[0] ?? null;
  const hostRaw = html.match(/<p title="([^"]+)" class="sh-font-22/)?.[1];
  const hostName = hostRaw ? decode(hostRaw) : null;
  const hostId = html.match(/openLoginModal\(&#39;\/profile\/(\d+)&#39;\)/)?.[1] ?? null;

  return {
    id,
    scrapedAt: new Date().toISOString(),
    url: `${BASE}/rental/${id}`,
    badge: header[0] ?? null,
    title: header[1] ?? (ld?.name as string | undefined) ?? null,
    place: header[2] ?? null,
    priceLine,
    pricePeriod,
    propertyType: afterPrice[0] ?? null,
    spaceType: afterPrice[1] ?? null,
    description: (ld?.description as string | undefined) ?? null,
    bedrooms: first("Bedrooms"),
    bathrooms: first("Bathrooms"),
    offices: first("Offices"),
    size: sec("Size").join(" ") || null,
    suitedFor: first("Suited For"),
    availability: sec("Availability"),
    minimumStay: first("Minimum Stay"),
    locationLine: first("Location"),
    closestUniversity: first("Closest University"),
    neighborhood: first("Neighborhood"),
    surroundings,
    rates,
    considerations,
    features,
    smokingAllowed: ld?.smokingAllowed ?? null,
    petsAllowed: ld?.petsAllowed ?? null,
    maxGuests: ld?.maximumAttendeeCapacity ?? null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    photos,
    hostName,
    hostId,
    memberSince: html.match(/<p class="text-center">Member Since (\d{4})<\/p>/)?.[1] ?? null,
    trustScore: Number(html.match(/Trust Score \((\d+)\)/)?.[1]) || null,
  };
}

const inBounds = (lat: number | null, lng: number | null) =>
  lat != null && lng != null && lat <= BOUNDS.north && lat >= BOUNDS.south && lng <= BOUNDS.east && lng >= BOUNDS.west;

async function main() {
  const startedAt = new Date().toISOString();
  const items: unknown[] = [];
  const errors: { id: string; error: string }[] = [];
  let status: "done" | "failed" = "done";
  let outOfBounds = 0;

  try {
    const ids = new Set<string>();
    for (const city of CITY_PAGES) {
      const html = await get(`/rentals-exchanges/united-states/homes-to-rent--california--${city}`);
      if (!html) {
        console.log(`  ${city}: no page`);
        continue;
      }
      const found = [...html.matchAll(/href="\/Rental\/(\d+)"/gi)].map((m) => m[1]);
      found.forEach((id) => ids.add(id));
      console.log(`  ${city}: ${new Set(found).size} rentals (${ids.size} unique so far)`);
    }

    for (const id of [...ids].slice(0, limit)) {
      try {
        const html = await get(`/rental/${id}`);
        if (!html) {
          errors.push({ id, error: "404" });
          continue;
        }
        const d = parseDetail(id, html);
        if (!inBounds(d.lat, d.lng)) {
          outOfBounds++;
          continue;
        }
        items.push(d);
        console.log(`  ✓ ${id} ${d.place} ${d.priceLine}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        errors.push({ id, error: String(err) });
        console.error(`  ✗ ${id}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  const complete = status === "done" && limit === Infinity && !errors.length;
  const file = { source: "sabbaticalhomes", market: MARKET, startedAt, finishedAt: new Date().toISOString(), complete, items };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/sabbaticalhomes-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log({ path, items: items.length, outOfBounds, errors: errors.length, complete });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
