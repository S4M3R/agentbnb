// HI USA (Hostelling International USA) hostels in the SF Bay Area, from hiusa.org's
// public pages.
//
//   npx tsx scripts/scrapers/hiusa.node.ts
//
// Lists hostels via the site's public WordPress REST endpoint (/wp-json/wp/v2/hostels),
// then fetches each California hostel page and its FAQ page. robots.txt allows all of
// this and asks for Crawl-delay: 10, so requests are sequential and 10s apart, with an
// honest User-Agent; stops on 403/429/503 or any bot challenge. The booking engine
// (bookings.hiusa.org) is never touched, so there are no prices or availability: hiusa.org
// only shows rates inside the booking flow. Writes one item per hostel per room type to
// data/scrapes/hiusa-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.hiusa.org";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const BOUNDS = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 }; // src/lib/markets.ts
const DELAY_MS = 10_000;

class StopError extends Error {}
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
    if (attempt >= 3) throw err;
    await sleep(5000 * attempt);
    return get(path, attempt + 1);
  }
  const body = await res.text();
  const challenged = /<title>Just a moment|cf_chl_opt|cf-chl-|g-recaptcha|h-captcha/i.test(body);
  if (res.status === 403 || res.status === 429 || res.status === 503 || challenged) {
    throw new StopError(`${path}: blocked (${res.status}); stopping`);
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(5000 * attempt);
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return body;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const text = (html?: string | null) =>
  decode((html ?? "").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]*>/g, " "))
    .replace(/\[email\s*protected\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

type Ld = {
  "@type"?: string;
  name?: string;
  description?: string;
  address?: Record<string, string>;
  telephone?: string;
  image?: string[];
  amenityFeature?: { name: string; value: boolean }[];
  potentialAction?: { target?: string };
};

function parseHostel(html: string) {
  let ld: Ld | null = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]) as Ld;
      if (j["@type"] === "Hotel" || j["@type"] === "Hostel") ld = j;
    } catch {
      /* ignore malformed blocks */
    }
  }
  const pin = html.match(/google\.com\/maps\/dir\/\?api=1&(?:amp;)?destination=(-?\d+\.\d+),(-?\d+\.\d+)/);
  const hostelCode =
    html.match(/id="hiusa-hostel-code-hidden"[^>]*value="([^"]+)"/)?.[1] ??
    ld?.potentialAction?.target?.match(/hostelcode=([A-Z0-9]+)/)?.[1] ??
    null;
  const basicsHtml = html.match(/<div class="hostel-basics">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const basics = [...basicsHtml.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1])).filter(Boolean);
  const amenities =
    ld?.amenityFeature?.filter((a) => a.value).map((a) => decode(a.name)) ??
    [...html.matchAll(/<div class="hostel-amenities__amenity">[\s\S]*?<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));

  const roomsHtml = html.match(/<section class="hostel-room-type">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const rooms = roomsHtml
    .split('<div class="hostel-room-type__room">')
    .slice(1)
    .map((r) => {
      const nums = [...r.matchAll(/<span class="sr-only">([^<]*)<\/span>[\s\S]*?<span>(\d+)<\/span>/g)];
      const num = (label: RegExp) => {
        const m = nums.find((n) => label.test(n[1]));
        return m ? Number(m[2]) : null;
      };
      return {
        name: text(r.match(/<h3 class="hostel-room-type__room-header">([\s\S]*?)<\/h3>/)?.[1]),
        beds: num(/beds/i),
        guests: num(/guests/i),
        ensuite: /Ensuite bathroom/i.test(text(r)),
        photos: [...r.matchAll(/data-content-image-src-\d+="([^"]+)"[\s\S]*?(?:data-content-image-caption-\d+="([^"]*)")?/g)].map(
          (m) => ({ url: m[1], caption: m[2] ? decode(m[2]) : null }),
        ),
      };
    })
    .filter((r) => r.name);

  const faqHref = html.match(/href="(https:\/\/www\.hiusa\.org\/[a-z0-9-]*faqs?)"/)?.[1] ?? null;
  const intro = html.match(/<div class="hostel-description__content">([\s\S]*?)<div class="hostel-basics">/)?.[1];

  return {
    name: ld?.name ? decode(ld.name) : text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]),
    description: ld?.description ? decode(ld.description).trim() : intro ? text(intro) : null,
    address: ld?.address ?? null,
    telephone: ld?.telephone ?? null,
    lat: pin ? Number(pin[1]) : null,
    lng: pin ? Number(pin[2]) : null,
    hostelCode,
    basics,
    amenities,
    photos: ld?.image ?? [],
    notice: text(html.match(/<div class="hostel-notice[^"]*">([\s\S]*?)<\/div>/)?.[1]) || null,
    rooms,
    faqUrl: faqHref,
  };
}

function parseFaq(html: string) {
  return [
    ...html.matchAll(
      /<h3 class="accordion__list-item-button-header">([\s\S]*?)<\/h3>[\s\S]*?<div class="accordion__list-item-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g,
    ),
  ].map((m) => ({ q: text(m[1]), a: text(m[2]) }));
}

const inBounds = (lat: number | null, lng: number | null) =>
  lat != null && lng != null && lat <= BOUNDS.north && lat >= BOUNDS.south && lng <= BOUNDS.east && lng >= BOUNDS.west;

async function main() {
  const startedAt = new Date().toISOString();
  const items: unknown[] = [];
  const notes: string[] = [];
  let complete = true;

  try {
    const list = JSON.parse(await get("/wp-json/wp/v2/hostels?per_page=100&_fields=id,slug,link,title,class_list")) as {
      id: number;
      slug: string;
      link: string;
      title: { rendered: string };
      class_list: string[];
    }[];
    const california = list.filter((h) => h.class_list.includes("hostels_states-california"));
    console.log(`${list.length} HI USA hostels, ${california.length} in California`);

    for (const h of california) {
      const page = parseHostel(await get(h.link));
      if (!inBounds(page.lat, page.lng)) {
        console.log(`  skip ${page.name} (outside ${MARKET})`);
        continue;
      }
      const faq = page.faqUrl ? parseFaq(await get(page.faqUrl)) : [];
      console.log(`  ${page.name}: ${page.rooms.length} room types, ${faq.length} FAQs`);
      if (!page.rooms.length) notes.push(`${page.name}: no room types on page`);
      const hostel = { wpId: h.id, slug: h.slug, url: h.link, ...page, faq };
      for (const room of page.rooms) items.push({ hostel, room });
    }
  } catch (err) {
    complete = false;
    console.error(err instanceof StopError ? err.message : err);
    notes.push(String(err instanceof Error ? err.message : err));
  }

  const finishedAt = new Date().toISOString();
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/hiusa-${MARKET}-${finishedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify({ source: "hiusa", market: MARKET, startedAt, finishedAt, complete, notes, items }, null, 2));
  console.log(`wrote ${items.length} items to ${path} (complete: ${complete})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
