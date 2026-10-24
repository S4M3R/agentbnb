// SpareRoom US scraper: rooms offered in shared homes around the SF Bay Area.
//
//   npx tsx scripts/scrapers/spareroom.node.ts [limit]
//
// Only fetches public, server-rendered pages that robots.txt allows: the region
// browse pages (/rooms-for-rent/san_francisco_bay_area[/pageN], no query params) and
// clean ad URLs (/rooms-for-rent/<area>/<hood>/<id>). Never touches /roommate/*.pl,
// search.pl, filters or sort params. Sequential, >= 1.2s between requests, honest
// User-Agent; stops on 403/429/503 or any bot challenge. Writes
// data/scrapes/spareroom-sf-bay-area-<timestamp>.json.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.spareroom.com";
const REGION = "/rooms-for-rent/san_francisco_bay_area";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const DELAY_MS = 1200;
const PAGE_SIZE = 10;

const limit = process.argv[2] ? Number(process.argv[2]) : Infinity;

class StopError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string, attempt = 1): Promise<string> {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  let res: Response;
  try {
    // Don't follow redirects: SpareRoom bounces some URLs to search.pl?action=search,
    // which robots.txt disallows.
    res = await fetch(new URL(path, BASE), { headers: { "User-Agent": USER_AGENT }, redirect: "manual" });
  } catch (err) {
    if (attempt < 4) {
      await sleep(2000 * attempt);
      return get(path, attempt + 1);
    }
    throw err;
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`${path}: redirected (${res.status}) to ${res.headers.get("location")}`);
  }
  const body = await res.text();
  const challenged = /<title>Just a moment|cf_chl_opt|g-recaptcha|h-captcha|captcha-delivery/i.test(body);
  if (res.status === 403 || res.status === 429 || challenged) {
    throw new StopError(`${path}: blocked (${res.status}); stopping`);
  }
  if (res.status >= 500 && attempt < 4) {
    await sleep(3000 * attempt);
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
  decode((html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
const oneLine = (html?: string | null) => text(html).replace(/\s+/g, " ");

function parseList(html: string) {
  const total = Number(html.match(/Showing <strong>[^<]*<\/strong> of <strong>([\d,]+)<\/strong>/)?.[1]?.replace(/,/g, ""));
  const start = html.indexOf('<ul class="listing-results');
  const end = html.indexOf("</ul>", html.lastIndexOf('<li class="listing-result"'));
  const list = start >= 0 ? html.slice(start, end > 0 ? end : undefined) : "";
  const cards = list
    .split('<li class="listing-result"')
    .slice(1)
    .map((li) => {
      const attrs: Record<string, string> = {};
      const open = li.slice(0, li.indexOf(">"));
      for (const m of open.matchAll(/data-listing-([a-z-]+)="([^"]*)"/g)) attrs[m[1]] = decode(m[2]);
      const href = li.match(/class="listing-card__link" href="([^"?]+)/)?.[1] ?? null;
      return {
        id: attrs.id ?? null,
        path: href,
        listingType: attrs.type ?? null, // "offered" | "wanted"
        brand: attrs.brand ?? null,
        daysOld: attrs["days-old"] ? Number(attrs["days-old"]) : null,
        availableNow: attrs["available-now"] === "1",
        status: attrs.status || null,
        verified: attrs["ad-verified"] === "yes",
        photoCount: attrs["ad-pics"] ? Number(attrs["ad-pics"]) : null,
        hasVideo: attrs["ad-video"] === "yes",
        neighbourhood: attrs.neighbourhood || null,
        postcode: attrs.postcode || null,
        propertyType: attrs["property-type"] || null,
        roomsInProperty: attrs["rooms-in-property"] ? Number(attrs["rooms-in-property"]) : null,
        advertiserRole: attrs["advertiser-role"] || null,
        headlineRate: attrs["ad-headline-rate"] || null,
        headlineRatePeriod: attrs["ad-headline-rate-period"] || null,
        normalisedRate: attrs["ad-rate-normalised"] || null,
        normalisedRatePeriod: attrs["ad-rate-normalised-period"] || null,
        cardTitle: attrs.title || oneLine(li.match(/<h2 class="listing-card__title">([\s\S]*?)<\/h2>/)?.[1]) || null,
        cardLocation: oneLine(li.match(/<p class="listing-card__location">([\s\S]*?)<\/p>/)?.[1]) || null,
        cardPrice: oneLine(li.match(/<p class="listing-card__price">([\s\S]*?)<\/p>/)?.[1]) || null,
        cardRoomType: oneLine(li.match(/<p class="listing-card__room-type">([\s\S]*?)<\/p>/)?.[1]) || null,
        shortDescription: oneLine(li.match(/<p class="listing-card__short_description">([\s\S]*?)<\/p>/)?.[1]) || null,
      };
    })
    .filter((c) => c.id && c.path);
  return { total: Number.isFinite(total) ? total : null, cards };
}

type Section = { heading: string | null; pairs: [string, string][]; items: string[] };

function parseDetail(html: string) {
  const advert = html.match(/advert: \{[\s\S]*?location: \{latitude: "(-?[\d.]+)",longitude: "(-?[\d.]+)"/);
  const title =
    decode(html.match(/data-ad-title="([^"]*)"/)?.[1] ?? "") ||
    decode(html.match(/<title>'([\s\S]*?)' Room to Rent/)?.[1] ?? "");

  const gallery = html.slice(html.indexOf('<div class="photo-gallery">'), html.indexOf('<p class="detaildesc">'));
  const photos = [
    ...new Set(
      [...gallery.matchAll(/href="(https:\/\/photos\.spareroom\.com\/images\/flatshare\/listings\/large\/[^"]+)"/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  const description = text(html.match(/<p class="detaildesc">([\s\S]*?)<\/p>/)?.[1]) || null;
  const keyFeatures = [
    ...(html.match(/<ul class="key-features">([\s\S]*?)<\/ul>/)?.[1] ?? "").matchAll(
      /<li class="key-features__feature">([\s\S]*?)<\/li>/g,
    ),
  ].map((m) => oneLine(m[1]));

  const sections: Record<string, Section> = {};
  for (const m of html.matchAll(/<section class="feature feature--([a-z_-]+)">([\s\S]*?)<\/section>/g)) {
    const name = m[1];
    if (name === "details" || name === "map") continue;
    const body = m[2];
    const pairs: [string, string][] = [];
    for (const dl of body.matchAll(/<dl class="feature-list">([\s\S]*?)<\/dl>/g)) {
      for (const p of dl[1].matchAll(
        /<dt class="feature-list__key">([\s\S]*?)<\/dt>\s*<dd class="feature-list__value">([\s\S]*?)<\/dd>/g,
      )) {
        pairs.push([oneLine(p[1]), oneLine(p[2])]);
      }
    }
    const items = [...body.matchAll(/<ul class="feature-list">([\s\S]*?)<\/ul>/g)].flatMap((ul) =>
      [...ul[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((li) => oneLine(li[1])),
    );
    sections[name] = {
      heading: oneLine(body.match(/<h3 class="feature__heading">([\s\S]*?)<\/h3>/)?.[1]) || null,
      pairs,
      items,
    };
  }

  const contact = html.slice(html.indexOf('<section class="listing-contact">'));
  // First name only (some advertisers put a surname in their display name).
  const displayName = oneLine(contact.match(/<strong class="profile-photo__name" itemprop="name">([\s\S]*?)<\/strong>/)?.[1]);
  const advertiser = {
    firstName: displayName.split(/\s+/)[0] || null,
    uuid: contact.match(/data-uuid="([^"]+)"/)?.[1] ?? null,
    photo: contact.match(/class="profile-photo advert-details__profile-photo"\s+alt="[^"]*" src="([^"]+)"/)?.[1] ?? null,
    role: oneLine(contact.match(/<\/div>\s*<em>([\s\S]*?)<\/em>/)?.[1]) || null,
  };

  return {
    title: title.trim() || null,
    lat: advert ? Number(advert[1]) : null,
    lng: advert ? Number(advert[2]) : null,
    isExpired: /is_expired: "1"/.test(html),
    isNowLet: /is_now_let: "1"/.test(html),
    description,
    keyFeatures,
    sections,
    photos,
    advertiser,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const errors: { id: string | null; error: string }[] = [];
  const items: unknown[] = [];
  let status: "done" | "failed" = "done";
  let total: number | null = null;

  try {
    const cards = new Map<string, ReturnType<typeof parseList>["cards"][number]>();
    for (let page = 1; ; page++) {
      const html = await get(page === 1 ? REGION : `${REGION}/page${page}`);
      const parsed = parseList(html);
      total ??= parsed.total;
      let fresh = 0;
      for (const c of parsed.cards) {
        if (!cards.has(c.id!)) {
          cards.set(c.id!, c);
          fresh++;
        }
      }
      console.log(`page ${page}: ${parsed.cards.length} cards (${fresh} new), ${cards.size}/${total ?? "?"}`);
      const lastPage = total ? Math.ceil(total / PAGE_SIZE) : page;
      if (!parsed.cards.length || page >= lastPage || cards.size >= limit) break;
    }

    const offered = [...cards.values()].filter((c) => c.listingType === "offered").slice(0, limit);
    console.log(`${offered.length} offered ads (of ${cards.size} cards)`);

    for (const card of offered) {
      try {
        const html = await get(card.path!);
        items.push({
          ...card,
          url: new URL(card.path!, BASE).href,
          scrapedAt: new Date().toISOString(),
          ...parseDetail(html),
        });
        console.log(`  ✓ ${card.id} ${card.path}`);
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

  const complete = status === "done" && limit === Infinity && !errors.length;
  const file = {
    source: "spareroom",
    market: MARKET,
    startedAt,
    finishedAt: new Date().toISOString(),
    complete,
    totalAdvertised: total,
    errors,
    items,
  };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/spareroom-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log({ path, items: items.length, errors: errors.length, complete });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
