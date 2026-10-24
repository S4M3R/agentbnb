// Bungalow (bungalow.com) coliving rooms in the Bay Area.
//
//   npx tsx scripts/scrapers/bungalow.node.ts
//
// Public, server-rendered pages only (robots.txt allows everything): the market index
// /rooms-for-rent/bay-area (JSON-LD ItemList + one Apartment block per home with
// lat/lng and amenities) and each home page (JSON-LD Product/ImageGallery + the
// "Available bedrooms" cards). One item per available bedroom. Current roommates'
// first names are on the page but are never kept. Sequential, >= 1.2s apart, honest
// User-Agent; stops on 403/429/challenge. Writes
// data/scrapes/bungalow-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://bungalow.com";
const MARKET_PATH = "/rooms-for-rent/bay-area";
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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const text = (html?: string | null) =>
  decode((html ?? "").replace(/<!---->/g, "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const money = (s?: string | null) => (s ? Number(s.replace(/[^0-9.]/g, "")) || null : null);
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Ld = Record<string, unknown> & { "@type"?: string | string[] };
function jsonLd(html: string): Ld[] {
  const out: Ld[] = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* ignore malformed blocks */
    }
  }
  return out;
}
const isType = (j: Ld, t: string) => (Array.isArray(j["@type"]) ? j["@type"].includes(t) : j["@type"] === t);

type IndexHome = {
  url: string;
  name: string;
  lat: number | null;
  lng: number | null;
  city: string | null;
  amenities: string[];
  numberOfRooms: number | null;
  thumbnail: string | null;
};

function parseIndex(html: string): IndexHome[] {
  return jsonLd(html)
    .filter((j) => isType(j, "Apartment") && typeof j.url === "string" && String(j.url).includes(`${MARKET_PATH}/`))
    .map((j) => ({
      url: String(j.url),
      name: String(j.name ?? ""),
      lat: typeof j.latitude === "number" ? j.latitude : null,
      lng: typeof j.longitude === "number" ? j.longitude : null,
      city: ((j.containedInPlace as { name?: string } | undefined)?.name ?? null) || null,
      amenities: Array.isArray(j.amenityFeature) ? (j.amenityFeature as string[]) : [],
      numberOfRooms: typeof j.numberOfRooms === "number" ? j.numberOfRooms : null,
      thumbnail: typeof j.photo === "string" ? j.photo : null,
    }));
}

function parseHome(html: string) {
  const ld = jsonLd(html);
  const product = ld.find((j) => isType(j, "Product"));
  const gallery = ld.find((j) => isType(j, "ImageGallery"));
  const photos = ((gallery?.associatedMedia as { contentUrl?: string }[] | undefined) ?? [])
    .map((m) => m.contentUrl)
    .filter((u): u is string => !!u);

  // Facts row: "🏠 Shared home", "📐 2083 Sqft", "🚫 No Pets", "🛌 7 bed / 4.0 bath", "🚙 4 parking spots".
  const body = text(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " "));
  const homeType = body.match(/🏠\s*([A-Za-z ]+?)\s*📐/)?.[1]?.trim() ?? null;
  const sqft = Number(body.match(/📐\s*([\d,]+)\s*Sqft/i)?.[1]?.replace(/,/g, "")) || null;
  const pets = body.match(/(?:🚫|🐶|🐱|🐾)\s*((?:No )?Pets[^🛌]*?)\s*🛌/)?.[1]?.trim() ?? null;
  const beds = Number(body.match(/🛌\s*(\d+)\s*bed/)?.[1]) || null;
  const baths = Number(body.match(/bed\s*\/\s*([\d.]+)\s*bath/)?.[1]) || null;
  const parking = body.match(/🚙\s*([^📍]+?)\s*📍/)?.[1]?.trim() ?? null;
  const fromRoommates = text(html.match(/From the Roommates[\s\S]{0,200}?class="about-us-text">([\s\S]*?)<\/span>/)?.[1]) || null;
  const esa = [...body.matchAll(/ESA (Cats|Dogs)\s*\S*\s*(Not OK|OK)/g)].map((m) => `ESA ${m[1]} ${m[2]}`);
  const tour3d = /3D tour/.test(body);

  // Room sizes from the house profile strip: "$1,150" "Master 2" "133 sqft".
  const sizes = new Map<string, number>();
  for (const m of html.matchAll(
    /profile-empty-room-text">([^<]*)<\/span><\/div><div class="profile-item-text"><b>([^<]+)<\/b><span>([\d,]+)\s*sqft/g,
  )) {
    sizes.set(nameKey(m[2]), Number(m[3].replace(/,/g, "")));
  }

  const roomsHtml = html.slice(
    html.indexOf('id="properties-available-bedrooms"'),
    html.indexOf('id="amenities-target"') > 0 ? html.indexOf('id="amenities-target"') : undefined,
  );
  const rooms = roomsHtml
    .split(/<div class="mb-5 col-md-6">/)
    .slice(1)
    .map((card) => {
      const name = text(card.match(/<span class="font-bold">([\s\S]*?)<\/span>/)?.[1]);
      return {
        name,
        availableText: text(card.match(/class="date-string">([\s\S]*?)<\/span>/)?.[1]) || null,
        priceText: text(card.match(/Rent for\s*<span[^>]*>([\s\S]*?)<\/span>/)?.[1]) || null,
        monthlyRent: money(card.match(/Rent for\s*<span[^>]*>([\s\S]*?)<\/span>/)?.[1]),
        leaseText: text(card.match(/with an? ([^<]*?lease)/)?.[1]) || null,
        sqft: sizes.get(nameKey(name)) ?? null,
      };
    })
    .filter((r) => r.name && r.monthlyRent);

  const offers = product?.offers as { lowPrice?: number; highPrice?: number } | undefined;
  return {
    title: String(product?.name ?? ""),
    description: typeof product?.description === "string" ? product.description : null,
    lowPrice: offers?.lowPrice ?? null,
    highPrice: offers?.highPrice ?? null,
    photos,
    homeType,
    sqft,
    pets,
    beds,
    baths,
    parking,
    esa,
    tour3d,
    fromRoommates,
    rooms,
    feesNote:
      body.match(/Does not include service fee[^.]*\.[^.]*\./)?.[0] ??
      "Does not include service fee, cleaning fee or utilities.",
    serviceFee: money(body.match(/flat \$(\d+) monthly fee/)?.[1]),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const items: unknown[] = [];
  let complete = true;
  let error: string | null = null;

  try {
    const homes = parseIndex(await get(MARKET_PATH));
    console.log(`${homes.length} homes in the Bay Area index`);
    for (const home of homes) {
      try {
        const detail = parseHome(await get(new URL(home.url).pathname));
        const slug = new URL(home.url).pathname.split("/").filter(Boolean).at(-1)!;
        for (const room of detail.rooms) {
          items.push({ slug, url: home.url, scrapedAt: new Date().toISOString(), home, ...detail, rooms: undefined, room });
        }
        console.log(`  ${slug}: ${detail.rooms.length} available room(s)`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        complete = false;
        console.error(`  ✗ ${home.url}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    complete = false;
    error = err instanceof Error ? err.message : String(err);
    console.error(error);
  }

  const finishedAt = new Date().toISOString();
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/bungalow-sf-bay-area-${finishedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(
    path,
    JSON.stringify({ source: "bungalow", market: "sf-bay-area", startedAt, finishedAt, complete, error, items }, null, 2),
  );
  console.log(`${items.length} rooms → ${path} (complete: ${complete})`);
}

main();
