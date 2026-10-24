// Craigslist SF Bay Area scraper: "rooms & shares" (roo) and "sublets & temporary" (sub).
//
//   npx tsx scripts/scrapers/craigslist.node.ts [limit=300]
//
// The search page (www.craigslist.org/search/area/sfbay?cat=<roo|sub>) is server-rendered
// with a no-JS result list plus a matching schema.org ItemList (same order), so one request
// per category yields ~300 posts. We then fetch the detail page of each post we keep.
// Small and slow on purpose: capped at `limit` posts total, sequential, >= 3s between
// requests, honest User-Agent, stops on 403/429 or any captcha/block page.
// Writes data/scrapes/craigslist-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.craigslist.org";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const DELAY_MS = 3200;
const CATEGORIES = [
  { cat: "roo", name: "rooms & shares", share: 0.6 },
  { cat: "sub", name: "sublets & temporary", share: 0.4 },
] as const;

const limit = process.argv[2] ? Number(process.argv[2]) : 300;

class StopError extends Error {}
class GoneError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
let blocks = 0;

async function get(url: string, attempt = 1): Promise<string> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    if (attempt < 4) {
      await sleep(5000 * attempt);
      return get(url, attempt + 1);
    }
    throw err;
  }
  const body = await res.text();
  const challenged = /hcaptcha\.com\/1\/api|class="h-captcha"|g-recaptcha|has been automatically blocked|<title>blocked<\/title>/i.test(
    body,
  );
  if (res.status === 403 || res.status === 429 || challenged) {
    blocks++;
    if (blocks >= 2 || challenged) throw new StopError(`${url}: blocked (${res.status}); stopping`);
    await sleep(30_000);
    return get(url, attempt + 1);
  }
  if (res.status === 404 || res.status === 410) throw new GoneError(`${url}: ${res.status}`);
  if (res.status >= 500 && attempt < 4) {
    await sleep(5000 * attempt);
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return body;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hearts: "♥" };
function decode(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const text = (html?: string | null) =>
  decode((html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const oneLine = (html?: string | null) =>
  text(html?.replace(/<sup>2<\/sup>/g, "2")).replace(/\s+/g, " ");

/** Wanted ads ("looking for a room") rather than offers. "Roommate wanted" is an offer. */
const OFFER_TARGET = /^\W*(a |an |another |new |my |our |one |the |\d+ )?(cool |great |nice |clean |quiet |responsible |replacement |female |male |\w+ )?(room ?mates?|house ?mates?|flat ?mates?|tenants?|person|people|someone|subletters?|sublessors?|renters?|lodgers?|guests?)\b/i;
const isWanted = (title: string) => {
  const t = title.replace(/^[^\p{L}]+/u, "");
  const lead = t.match(/^(wanted|looking for|looking to rent|seeking|searching for|in search of|iso)\b:?(.*)$/i);
  if (lead) return !OFFER_TARGET.test(lead[2]);
  return (
    /\b(room|place|sublet|housing|apartment|studio|home) wanted\b/i.test(t) ||
    /\bneed(ing|s)? (a |an )?(temporary |short[- ]term )?(room|place|sublet|housing|studio)\b/i.test(t) ||
    /\b(tattoo|salon|esthetician|nail tech|office space|commercial)\b/i.test(t)
  );
};

type Card = {
  category: string;
  slug: string;
  url: string;
  title: string;
  listPrice: string | null;
  listLocation: string | null;
  listLat: number | null;
  listLng: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
};

function parseSearch(html: string, category: string): Card[] {
  const ld = html.match(/id="ld_searchpage_results"\s*>\s*([\s\S]*?)<\/script>/)?.[1];
  type LdItem = { item?: { latitude?: number; longitude?: number; numberOfBedrooms?: number; numberOfBathroomsTotal?: number } };
  const ldItems: LdItem[] = ld ? (JSON.parse(ld).itemListElement ?? []) : [];
  const lis = [...html.matchAll(/<li class="cl-static-search-result" title="([^"]*)">([\s\S]*?)<\/li>/g)];
  return lis
    .map((m, i) => {
      const href = m[2].match(/<a href="([^"]+)"/)?.[1] ?? "";
      const it = lis.length === ldItems.length ? ldItems[i]?.item : undefined;
      return {
        category,
        slug: href.split("/").pop() ?? "",
        url: href,
        title: decode(m[1]),
        listPrice: oneLine(m[2].match(/class="price">([\s\S]*?)<\/div>/)?.[1]) || null,
        listLocation: oneLine(m[2].match(/class="location">([\s\S]*?)<\/div>/)?.[1]) || null,
        listLat: it?.latitude ?? null,
        listLng: it?.longitude ?? null,
        bedrooms: it?.numberOfBedrooms ?? null,
        bathrooms: it?.numberOfBathroomsTotal ?? null,
      };
    })
    .filter((c) => c.slug && c.url.startsWith(BASE));
}

function parseDetail(html: string) {
  if (/This posting has been (deleted|flagged|expired)|posting has expired/i.test(html)) {
    return { removed: true as const };
  }
  const ldPosting = html.match(/id="ld_posting_data"\s*>\s*([\s\S]*?)<\/script>/)?.[1];
  let posting: Record<string, unknown> = {};
  try {
    posting = ldPosting ? JSON.parse(ldPosting) : {};
  } catch {}
  const address = (posting.address ?? {}) as Record<string, string>;
  const crumbs = html.match(/id="ld_breadcrumb_data"\s*>\s*([\s\S]*?)<\/script>/)?.[1];
  let subarea: string | null = null;
  let subareaName: string | null = null;
  try {
    const c = crumbs ? JSON.parse(crumbs).itemListElement.find((x: { position: number }) => x.position === 2) : null;
    subarea = c?.item?.match(/\/subarea\/(\w+)/)?.[1] ?? null;
    subareaName = c?.name ?? null;
  } catch {}

  const map = html.match(/id="map"[^>]*data-latitude="(-?[\d.]+)"[^>]*data-longitude="(-?[\d.]+)"(?:[^>]*data-accuracy="(\d+)")?/);
  const titleText = oneLine(html.match(/<span id="titletextonly">([\s\S]*?)<\/span>/)?.[1]) || null;
  const price = oneLine(html.match(/<h1 class="postingtitle">[\s\S]*?<span class="price">([\s\S]*?)<\/span>/)?.[1]) || null;
  const housing = oneLine(html.match(/<span class="housing">([\s\S]*?)<\/span>/)?.[1]) || null;
  const hood = oneLine(html.match(/<span id="titletextonly">[\s\S]*?<\/span><span>\s*\(([^)]*)\)/)?.[1]) || null;

  // Attribute groups: "important" chips (1BR / 1Ba, 500ft2, available nov 1) and the
  // labelled / free-form attrs (private room, furnished, laundry, parking, pets...).
  const attrsHtml = html.slice(html.indexOf('<div class="attrgroup">'), html.indexOf('<section id="postingbody">'));
  const important = [...attrsHtml.matchAll(/<span class="attr important[^"]*">([\s\S]*?)<\/span>/g)].map((m) => oneLine(m[1]));
  const attrs: { key: string | null; label: string | null; value: string }[] = [
    ...attrsHtml.matchAll(/<div class="attr(?: ([\w-]+))?">([\s\S]*?)<\/div>/g),
  ].map((m) => ({
    key: m[1] || null,
    label: oneLine(m[2].match(/<span class="labl">([\s\S]*?)<\/span>/)?.[1]).replace(/:$/, "") || null,
    value: oneLine(m[2].match(/<span class="valu">([\s\S]*?)<\/span>/)?.[1] ?? m[2]),
  }));

  let body = html.match(/<section id="postingbody">([\s\S]*?)<\/section>/)?.[1] ?? "";
  body = body.replace(/<div class="print-information[\s\S]*?<\/div>\s*<\/div>/, "");
  body = body.replace(/<a [^>]*class="show-contact"[\s\S]*?<\/a>/g, "");
  const description = text(body) || null;

  const imgList = html.match(/var imgList = (\[[\s\S]*?\]);/)?.[1];
  let photos: string[] = [];
  try {
    photos = imgList ? (JSON.parse(imgList) as { url: string }[]).map((p) => p.url) : [];
  } catch {}
  if (!photos.length) {
    const single = html.match(/<div class="slide first visible">\s*<img src="([^"]+)"/)?.[1];
    if (single) photos = [single];
  }

  const postId = html.match(/<p class="postinginfo">post id: (\d+)<\/p>/)?.[1] ?? null;
  const posted = html.match(/posted: <time class="date timeago" datetime="([^"]+)"/)?.[1] ?? null;
  const updated = html.match(/updated: <time class="date timeago" datetime="([^"]+)"/)?.[1] ?? null;
  const expires = html.match(/<meta name="robots" content="unavailable_after: ([^"]+)"/)?.[1] ?? null;

  return {
    removed: false as const,
    postId,
    title: titleText,
    price,
    housing,
    hood,
    city: address.addressLocality || null,
    postalCode: address.postalCode || null,
    subarea,
    subareaName,
    lat: map ? Number(map[1]) : null,
    lng: map ? Number(map[2]) : null,
    mapAccuracy: map?.[3] ? Number(map[3]) : null,
    important,
    attrs,
    petsAllowed: (posting.petsAllowed as boolean | undefined) ?? null,
    smokingAllowed: (posting.smokingAllowed as boolean | undefined) ?? null,
    bedrooms: posting.numberOfBedrooms != null ? Number(posting.numberOfBedrooms) : null,
    bathrooms: posting.numberOfBathroomsTotal != null ? Number(posting.numberOfBathroomsTotal) : null,
    description,
    photos,
    postedAt: posted,
    updatedAt: updated,
    expiresAt: expires,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const errors: { slug: string | null; error: string }[] = [];
  const items: unknown[] = [];
  const found: Record<string, number> = {};
  let status: "done" | "failed" = "done";
  let removed = 0;
  let wanted = 0;

  try {
    const picked: Card[] = [];
    const seen = new Set<string>();
    for (const { cat, share } of CATEGORIES) {
      const html = await get(`${BASE}/search/area/sfbay?cat=${cat}`);
      const cards = parseSearch(html, cat);
      found[cat] = cards.length;
      const offers = cards.filter((c) => {
        if (isWanted(c.title)) {
          wanted++;
          return false;
        }
        return !seen.has(c.slug);
      });
      const take = offers.slice(0, Math.round(limit * share));
      take.forEach((c) => seen.add(c.slug));
      picked.push(...take);
      console.log(`${cat}: ${cards.length} posts on search page, keeping ${take.length}`);
    }

    for (const [i, card] of picked.entries()) {
      try {
        const detail = parseDetail(await get(card.url));
        if (detail.removed) {
          removed++;
          console.log(`  - ${card.slug} removed`);
          continue;
        }
        items.push({ ...card, scrapedAt: new Date().toISOString(), ...detail });
        console.log(`  ✓ ${i + 1}/${picked.length} ${card.category} ${detail.postId} ${detail.price} ${card.title.slice(0, 50)}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        if (err instanceof GoneError) {
          removed++;
          continue;
        }
        errors.push({ slug: card.slug, error: String(err) });
        console.error(`  ✗ ${card.slug}: ${err}`);
      }
    }
  } catch (err) {
    status = "failed";
    console.error(String(err));
  }

  const file = {
    source: "craigslist",
    market: MARKET,
    startedAt,
    finishedAt: new Date().toISOString(),
    // Capped demo run: never a full snapshot of the categories.
    complete: false,
    status,
    foundOnSearchPages: found,
    skippedWanted: wanted,
    removed,
    errors,
    items,
  };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/craigslist-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log({ path, items: items.length, errors: errors.length, removed, wanted, status });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
