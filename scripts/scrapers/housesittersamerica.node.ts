// Node fallback for scripts/scrapers/housesittersamerica.browser.js, for when the
// shared browser isn't available. Same public pages, same output file format.
//
//   npx tsx --env-file=.env.local scripts/scrapers/housesittersamerica.node.ts [state] [limit]
//
// Only fetches the public, server-rendered state directory and job pages (both
// allowed by robots.txt; /search is not and is never touched), sequentially with
// >= 1s between requests and an honest User-Agent. Stops on 403/429 or any bot
// challenge instead of working around it. Writes
// data/scrapes/housesittersamerica-<market>-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.housesittersamerica.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const DELAY_MS = 1200;

const state = process.argv[2] ?? "california";
const limit = process.argv[3] ? Number(process.argv[3]) : Infinity;

class StopError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string) {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT } });
  const body = await res.text();
  // Every page carries Cloudflare's passive /cdn-cgi/challenge-platform/scripts/jsd script;
  // an actual interstitial or captcha looks like this instead.
  const challenged = /<title>Just a moment|cf_chl_opt|cf-chl-|g-recaptcha|h-captcha/i.test(body);
  if (res.status === 403 || res.status === 429 || res.status === 503 || challenged) {
    throw new StopError(`${path}: blocked (${res.status}); stopping`);
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
/** Strip tags and collapse whitespace, like textContent + trim. */
const text = (html?: string | null) =>
  decode((html ?? "").replace(/<[^>]*>/g, " "))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();

const jobId = (href?: string | null) => href?.match(/\/house-sitting-pet-sitting-job\/(\d+)\//)?.[1] ?? null;

function parseCards(html: string) {
  const start = html.indexOf('class="search-list-results"');
  if (start === -1) return [];
  // Only cards inside the main results list (not sidebars/carousels).
  const listHtml = html.slice(start, html.indexOf('id="refine', start) > 0 ? html.indexOf('id="refine', start) : undefined);
  return listHtml
    .split('<div class="card primary with-header search-listing">')
    .slice(1)
    .map((card) => {
      const link = card.match(/<h3><a href="(\/house-sitting-pet-sitting-job\/[^"]+)"/)?.[1] ?? null;
      const icons = [...card.matchAll(/<li><span class="icon">([^<]+)<\/span>([\s\S]*?)<\/li>/g)].map((m) => ({
        icon: m[1].trim(),
        value: text(m[2]),
      }));
      return {
        id: jobId(link),
        url: link ? new URL(link, BASE).href : null,
        cardDates: icons.find((i) => i.icon === "date_range")?.value ?? null,
        duration: icons.find((i) => i.icon === "schedule")?.value ?? null,
        homeType: icons.find((i) => i.icon === "cottage")?.value ?? null,
        pay: text(card.match(/class="pay-info">[\s\S]*?<span class="label">([\s\S]*?)<\/span>/)?.[1]) || null,
        tag: text(card.match(/<div class="listing-tag">([\s\S]*?)<\/div>/)?.[1]) || null,
        startsSoon: /class="urgent/.test(card),
        pets: [...card.matchAll(/<li><img [^>]*alt="([^"]*)"[^>]*><span>(\d*)<\/span><\/li>/g)].map((m) => ({
          animal: m[1] || null,
          count: Number(m[2]) || null,
        })),
      };
    })
    .filter((c) => c.id && c.url);
}

function parseDetail(html: string) {
  let ld: unknown = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j["@type"] === "JobPosting") ld = j;
    } catch {
      /* ignore malformed blocks */
    }
  }
  const layoutStart = html.indexOf('id="profile-layout"');
  const reviewsStart = html.indexOf('id="reviews"');
  const layout = html.slice(layoutStart, reviewsStart > 0 ? reviewsStart : undefined);

  // <div class="profile-data"><h4><span class="icon">X</span>[<span class="label">L</span>][<span class="data">V</span>]...</h4>[<p>V</p>]
  const data: Record<string, string> = {};
  for (const m of layout.matchAll(/<div class="profile-data">([\s\S]*?)<\/div>/g)) {
    const block = m[1];
    const icon = text(block.match(/<span class="icon">([^<]*)<\/span>/)?.[1]);
    const label = text(block.match(/<span class="label">([\s\S]*?)<\/span>/)?.[1]).replace(/:$/, "");
    const value =
      text(block.match(/<span class="data">([\s\S]*?)<\/span>\s*<\/h4>/)?.[1]) ||
      text(block.match(/<p>([\s\S]*?)<\/p>/)?.[1]) ||
      text(block.match(/class="chip[^"]*">([\s\S]*?)$/)?.[1]);
    data[label || icon] = value;
  }
  const sections: Record<string, string> = {};
  for (const m of layout.matchAll(/<section class="profile-section">([\s\S]*?)<\/section>/g)) {
    const h = text(m[1].match(/<h2>([\s\S]*?)<\/h2>/)?.[1]);
    const desc = text(m[1].match(/<div class="profile-description">([\s\S]*?)<\/div>/)?.[1]);
    if (h && desc) sections[h] = desc;
  }
  const heading = html.match(/<div class="combo-heading">([\s\S]*?)<\/div>\s*<div id="profile-column">/)?.[1] ?? "";
  const h3s = [...heading.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => text(m[1]));
  const pin = html.match(/google\.maps\.LatLng\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  const reviews = reviewsStart > 0 ? html.slice(reviewsStart) : "";
  const ratings = [...reviews.matchAll(/<div class="review-header">\s*<img [^>]*title="Rating: ([\d.]+)"/g)].map((m) =>
    Number(m[1]),
  );
  const thumbs = html.match(/<div class="profile-photo-thumbs">([\s\S]*?)<div class="contact-button">/)?.[1] ?? "";
  const photos = [...thumbs.matchAll(/<a href="([^"]+)" onclick="return selectProfileThumb/g)].map(
    (m) => new URL(m[1], BASE).href,
  );
  const mainPhoto = html.match(/<div class="profile-photo">\s*<a [^>]*style="background-image:url\(([^)]+)\)/)?.[1];
  const trust = [...layout.matchAll(/class="profile-feature[^"]*">[\s\S]*?<span class="label">([\s\S]*?)<\/span>/g)].map(
    (m) => text(m[1]),
  );

  return {
    ld,
    city: text(heading.match(/<h1>([\s\S]*?)<\/h1>/)?.[1]),
    area: text(heading.match(/<h3 class="sub-text">([\s\S]*?)<\/h3>/)?.[1]),
    title: h3s.at(-1) ?? "",
    dates: data.date_range ?? null,
    locationPath: data.my_location ?? null,
    payment: data.Payment ?? null,
    areaLove: data["What we love about our area"] ?? null,
    houseType: data["House type"] ?? null,
    features: data.Features ?? null,
    accessibility: data["Home accessibility"] ?? null,
    locale: data.Locale ?? null,
    nearby: data.Nearby ?? null,
    gardenCare: data["Garden or plant care"] ?? null,
    guestsWelcome: data["Guests welcome"] ?? null,
    petsWelcome: data["Pets welcome"] ?? null,
    smoking: data["Smoking/vaping permitted"] ?? null,
    home: sections["Our home"] ?? null,
    petsDescription: sections["Our pets"] ?? null,
    gardenDescription: sections["Our garden"] ?? null,
    petChips: [...layout.matchAll(/<div class="pet-chip">[\s\S]*?<span class="label">([\s\S]*?)<\/span>/g)].map((m) =>
      text(m[1]),
    ),
    owner: text(layout.match(/<label>Owner:<\/label>([\s\S]*?)<\/p>/)?.[1]) || null,
    memberSince: trust.find((t) => /^Member since/i.test(t))?.replace(/^Member since\s*/i, "") ?? null,
    replyRating: Number(html.match(/alt="Reply Rating (\d+)"/)?.[1]) || null,
    reviewCount: ratings.length,
    reviewAverage: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    lat: pin ? Number(pin[1]) : null,
    lng: pin ? Number(pin[2]) : null,
    photos: photos.length ? photos : mainPhoto ? [new URL(mainPhoto, BASE).href] : [],
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const errors: { id: string | null; error: string }[] = [];
  const items: unknown[] = [];
  let status: "done" | "failed" = "done";

  try {
    const listHtml = await get(`/house-sitting-pet-sitting-jobs/browse/${state}`);
    // The state directory currently fits on one page (no pagination links).
    if (/rel="next"|[?&]page=\d/.test(listHtml)) console.warn("warning: pagination detected, only page 1 scraped");
    const cards = [...new Map(parseCards(listHtml).map((c) => [c.id, c])).values()].slice(0, limit);
    console.log(`${cards.length} jobs in ${state}`);

    for (const card of cards) {
      try {
        const html = await get(card.url!);
        items.push({ ...card, ...parseDetail(html) });
        console.log(`  ✓ ${card.id} ${card.url}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        errors.push({ id: card.id, error: String(err) });
        console.error(`  ✗ ${card.id}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  // A partial scrape must not mark unseen listings as gone.
  const complete = status === "done" && limit === Infinity && !errors.length;
  const file = {
    source: "housesittersamerica",
    market: MARKET,
    startedAt,
    finishedAt: new Date().toISOString(),
    complete,
    items,
  };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/housesittersamerica-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log({ path, items: items.length, errors: errors.length, complete });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
