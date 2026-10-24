// Hostelworld hostels in the SF Bay Area, from public, server-rendered pages.
//
//   npx tsx scripts/scrapers/hostelworld.node.ts [--availability]
//
// Fetches each Bay Area city page (/hostels/north-america/usa/<city>/?currency=USD) and
// each property page (/hostels/p/<id>/<slug>/?currency=USD); both are allowed by
// robots.txt (api.hostelworld.com, /search and /s are not, and the base pass never touches them).
// Data comes from the pages' embedded Nuxt payload, parsed without evaluating it
// (see hostelworld.nuxt.ts). Without --availability no dates are selected, so prices are the public
// "from" prices and no availability is collected. Sequential, >= 1.5s apart, honest
// User-Agent; stops on 403/429/503 or any bot challenge. Writes one item per property
// per room category (dorm / private) to data/scrapes/hostelworld-sf-bay-area-<ts>.json.
//
// --availability adds a date pass (robots.txt disallows date searches; opted into for the
// demo): for each property found above, the public availability JSON the property page
// itself loads (prod.apigee.hostelworld.com/legacy-hwapi-service/2.2/properties/<id>/
// availability, no login or key) is fetched for each of the next 3 weekends (Fri-Sun,
// 1 guest, 2 nights). Each item then carries `weekends` and its `priceFrom` becomes the
// lowest weekend price seen. Requests are >= 2s apart in this mode.
// Status (2026-10-24): the API answers plain curl but returns a bare 403 to Node's fetch,
// so the pass stops on its first request. Per the scraping policy the request headers are
// not altered to get past it; the base pass is unaffected.

import { mkdir, writeFile } from "node:fs/promises";
import { parseNuxt } from "./hostelworld.nuxt";

const BASE = "https://www.hostelworld.com";
const USER_AGENT = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";
const MARKET = "sf-bay-area";
const AVAILABILITY = process.argv.includes("--availability");
const DELAY_MS = AVAILABILITY ? 2000 : 1500;
const HWAPI = "https://prod.apigee.hostelworld.com/legacy-hwapi-service/2.2";
const WEEKENDS = 3;

/** Hostelworld city slugs in/around the Bay Area (empty ones are checked and skipped). */
const CITIES = [
  "san-francisco",
  "oakland",
  "berkeley",
  "san-jose",
  "sausalito",
  "half-moon-bay",
  "montara",
  "pescadero",
  "santa-cruz",
];

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(path: string, attempt = 1): Promise<string> {
  // Absolute URLs (the availability API) pass through new URL() unchanged.
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
  if (res.status === 403 || res.status === 429 || res.status === 503 || challenged) {
    throw new StopError(`${path}: blocked (${res.status}); stopping`);
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(2000 * 2 ** attempt);
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return body;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Obj) : {});

/** The Nuxt `data` entry whose key starts with `prefix` (keys embed ids/locale/currency). */
function dataEntry(nuxt: Obj, prefix: string, filter?: (v: Obj) => boolean) {
  const data = obj(nuxt.data);
  return Object.entries(data)
    .filter(([k, v]) => k.startsWith(prefix) && (!filter || filter(obj(v))))
    .map(([, v]) => obj(v));
}

const https = (u?: unknown) => (typeof u === "string" && u ? (u.startsWith("http") ? u : `https://${u}`) : null);

async function scrapeCity(city: string) {
  const html = await get(`/hostels/north-america/usa/${city}/?currency=USD`);
  const nuxt = parseNuxt(html);
  if (!nuxt) throw new Error(`${city}: no Nuxt payload`);
  const cityData = obj(dataEntry(nuxt, "getCityByCityNameAndCountryName")[0]?.data);
  const lists = dataEntry(nuxt, "getCityProperties", (v) => Array.isArray(obj(v.data).properties));
  const byId = new Map<number, Obj>();
  for (const l of lists) for (const p of obj(l.data).properties as Obj[]) byId.set(p.id as number, p);
  return {
    city,
    cityName: (cityData.name as string) ?? null,
    numberOfProperties: (cityData.numberOfProperties as number) ?? byId.size,
    properties: [...byId.values()].filter((p) => p.urlFriendlyCity === city),
  };
}

async function scrapeProperty(p: Obj) {
  const html = await get(`/hostels/p/${p.id}/${p.urlFriendlyName}/?currency=USD`);
  const nuxt = parseNuxt(html);
  if (!nuxt) throw new Error(`${p.id}: no Nuxt payload`);
  const ms = dataEntry(nuxt, "getPropertyByPropertyIdMsApi")[0] ?? {};
  const pdp = obj(dataEntry(nuxt, "getPropertyByPropertyIden", (v) => "data" in v)[0]?.data);
  const loc = obj(ms.location);
  const addr = obj(obj(pdp.location).address);
  const facilities = ((ms.facilities as Obj[] | undefined) ?? []).map((c) => ({
    category: c.name ?? c.id,
    codes: ((c.facilities as Obj[] | undefined) ?? []).map((f) => f.name ?? f.transCode ?? f.id),
  }));
  const images = ((ms.images as Obj[] | undefined) ?? [])
    .map((i) => https(`${i.prefix}${i.suffix}`))
    .filter(Boolean) as string[];
  const hr = obj(ms.houseRules);
  return {
    type: ms.type ?? pdp.type ?? null,
    isActive: ms.isActive ?? pdp.active ?? null,
    description: (ms.description as string) ?? null,
    address1: (loc.address1 as string) || (addr.line1 as string) || null,
    address2: (loc.address2 as string) || (addr.line2 as string) || null,
    postalCode: (addr.postalCode as string) ?? null,
    region: (obj(loc.region).name as string) ?? null,
    latitude: loc.latitude != null ? Number(loc.latitude) : null,
    longitude: loc.longitude != null ? Number(loc.longitude) : null,
    directions: (loc.directions as string) ?? null,
    maxGuestsPerBooking: ms.maxGuestsPerBooking ?? null,
    depositPercentage: ms.depositPercentage ?? null,
    ratings: ms.ratings ?? null,
    reviewCount: obj(pdp.reviews).totalCount ?? null,
    houseRules: {
      notes: hr.notes ?? null,
      checkin: hr.checkin ?? null,
      latestCheckout: hr.latestCheckout ?? null,
      cancellationPolicy: hr.cancellationPolicy ?? null,
      smoking: hr.smoking ?? null,
      pets: hr.pets ?? null,
      ageLimit: hr.ageLimit ?? null,
      curfew: hr.curfew ?? null,
      children: hr.children ?? null,
    },
    taxes: ms.taxes ?? null,
    facilities,
    images,
    lowestPricePerNight: pdp.lowestPricePerNight ?? null,
  };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The next `n` Friday check-ins (strictly after today) with their Sunday check-outs. */
function nextWeekends(n: number, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + (((5 - d.getUTCDay() + 7) % 7) || 7));
  return Array.from({ length: n }, (_, i) => {
    const fri = new Date(d);
    fri.setUTCDate(d.getUTCDate() + 7 * i);
    const sun = new Date(fri);
    sun.setUTCDate(fri.getUTCDate() + 2);
    return { checkIn: ymd(fri), checkOut: ymd(sun) };
  });
}

type Price = { value: number; currency: string } | null;
const price = (v: unknown): Price => {
  const p = obj(v);
  const value = Number(p.value);
  return value > 0 ? { value, currency: String(p.currency ?? "USD") } : null;
};

/** One weekend's availability for one property, split by room category. */
async function weekendAvailability(id: unknown, w: { checkIn: string; checkOut: string }) {
  const q = new URLSearchParams({ guests: "1", "num-nights": "2", "date-start": w.checkIn, currency: "USD", application: "web" });
  const a = JSON.parse(await get(`${HWAPI}/properties/${id}/availability/?${q}`)) as Obj;
  const rooms = obj(a.rooms);
  const summarize = (list: unknown) =>
    ((list as Obj[] | undefined) ?? []).map((r) => ({
      name: (r.name as string) ?? null,
      basicType: (r.basicType as string) ?? null,
      capacity: r.capacity != null ? Number(r.capacity) : null,
      ensuite: r.ensuite === "1" || r.ensuite === 1 || r.ensuite === true,
      bedsAvailable: (r.totalBedsAvailable as number) ?? null,
      roomsAvailable: (r.totalRoomsAvailable as number) ?? null,
      lowestPricePerNight: price(r.lowestPricePerNight),
      averagePricePerNight: price(obj((r.averagePricePerNight as Obj[] | undefined)?.[0]).price),
      totalPrice: price(obj((r.totalPrice as Obj[] | undefined)?.[0]).price),
    }));
  const base = { ...w, nights: 2, guests: 1, checkedAt: new Date().toISOString() };
  return {
    dorm: { ...base, lowestPricePerNight: price(a.lowestDormPricePerNight), averagePricePerNight: price(a.lowestAverageDormPricePerNight), rooms: summarize(rooms.dorms) },
    private: { ...base, lowestPricePerNight: price(a.lowestPrivatePricePerNight), averagePricePerNight: price(a.lowestAveragePrivatePricePerNight), rooms: summarize(rooms.privates) },
    freeCancellationUntil: (a.freeCancellationAvailableUntil as string) ?? null,
    stayRuleViolations: a.stayRuleViolations ?? [],
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const seenAt = startedAt.slice(0, 10);
  const items: unknown[] = [];
  let complete = true;
  const notes: string[] = [];
  let availabilityErrors = 0;

  try {
    for (const city of CITIES) {
      const c = await scrapeCity(city);
      console.log(`${city}: ${c.properties.length} properties (city says ${c.numberOfProperties})`);
      if (c.properties.length < (c.numberOfProperties ?? 0)) {
        complete = false;
        notes.push(`${city}: only ${c.properties.length}/${c.numberOfProperties} properties on the public page`);
      }
      for (const p of c.properties) {
        const detail = await scrapeProperty(p);
        const listEntry = {
          id: p.id,
          name: p.name,
          type: p.type,
          urlFriendlyName: p.urlFriendlyName,
          address: p.address,
          city: p.city,
          urlFriendlyCity: p.urlFriendlyCity,
          avgRating: p.avgRating,
          numberReviews: p.numberReviews,
          cityCenterDistance: p.cityCenterDistance,
          hasAvailability: p.hasAvailability,
          isNew: p.isNew,
          badges: ((p.badges as Obj[] | undefined) ?? []).map((b) => b.name ?? b.badgeName),
          intro: p.intro,
          latitude: obj(p.geoCoordinates).latitude ?? p.latitude ?? null,
          longitude: obj(p.geoCoordinates).longitude ?? p.longitude ?? null,
          averageRatings: p.averageRatings,
          minDormPrice: p.minDormPrice ?? p.sharedMinPrice ?? null,
          minPrivatePrice: p.minPrivatePrice ?? p.privateMinPrice ?? null,
          images: ((p.images as Obj[] | undefined) ?? []).map((i) => https(i.large)).filter(Boolean),
        };
        const url = `${BASE}/hostels/p/${p.id}/${p.urlFriendlyName}/`;
        const weekends: Awaited<ReturnType<typeof weekendAvailability>>[] = [];
        if (AVAILABILITY) {
          for (const w of nextWeekends(WEEKENDS)) {
            try {
              weekends.push(await weekendAvailability(p.id, w));
            } catch (err) {
              if (err instanceof StopError) throw err;
              availabilityErrors++;
              notes.push(`${p.id} ${w.checkIn}: ${err instanceof Error ? err.message : err}`);
            }
          }
        }
        for (const category of ["dorm", "private"] as const) {
          const listed = price(category === "dorm" ? listEntry.minDormPrice : listEntry.minPrivatePrice);
          const cat = weekends.map((w) => ({ ...w[category], available: w[category].rooms.length > 0 }));
          const weekendLows = cat.map((w) => w.lowestPricePerNight).filter((x): x is NonNullable<Price> => !!x);
          const lowest = weekendLows.sort((a, b) => a.value - b.value)[0] ?? null;
          // With the date pass, "from" is the lowest weekend price; else the listed "from" price.
          const priceFrom = lowest ?? listed;
          if (!priceFrom) continue; // 0 = "No Dorms/Privates Available"
          items.push({
            category,
            url,
            seenAt,
            priceFrom,
            priceFromSource: lowest ? "weekend_availability" : "listed",
            listedPriceFrom: listed,
            ...(AVAILABILITY ? { weekends: cat } : {}),
            property: listEntry,
            detail,
          });
        }
        console.log(
          `  ${p.name}: dorm ${obj(listEntry.minDormPrice).value ?? "-"} / private ${obj(listEntry.minPrivatePrice).value ?? "-"}` +
            (AVAILABILITY
              ? ` | weekends ${weekends.map((w) => `${w.dorm.checkIn} d:${w.dorm.lowestPricePerNight?.value ?? "-"} p:${w.private.lowestPricePerNight?.value ?? "-"}`).join(", ")}`
              : ""),
        );
      }
    }
  } catch (err) {
    complete = false;
    console.error(err instanceof StopError ? err.message : err);
    notes.push(String(err instanceof Error ? err.message : err));
  }

  if (availabilityErrors) complete = false;
  const finishedAt = new Date().toISOString();
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/hostelworld-${MARKET}-${finishedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(
      { source: "hostelworld", market: MARKET, startedAt, finishedAt, complete, availability: AVAILABILITY, notes, items },
      null,
      2,
    ));
  console.log(`wrote ${items.length} items to ${path} (complete: ${complete})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
