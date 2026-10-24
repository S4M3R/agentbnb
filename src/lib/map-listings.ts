import { cacheLife, cacheTag } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type MapListing = {
  id: string;
  sourceId: string;
  sourceName: string;
  /** The source's kind: couch, house_sit, home_swap, rental, hostel, ... (`internal` for our own hosts). */
  sourceKind: string;
  type: string;
  title: string;
  place: string | null;
  lat: number;
  lng: number;
  /** True when the pin is offset from a shared city/approximate centroid. */
  approximate: boolean;
  url: string | null;
  photo: string | null;
  rating: number | null;
  maxGuests: number | null;
  /** Short "what you'd do" line: pets to care for, kinds of help, ... */
  summary: string | null;
  nextAvailable: { start: string; end: string } | null;
  /** free, exchange (sits, swaps, volunteering) or paid. */
  priceModel: "free" | "exchange" | "paid";
  /** Paid listings only, in the minor unit of `currency`. */
  priceCents: number | null;
  /** What `priceCents` is per; null when the source doesn't say. */
  pricePeriod: "night" | "week" | "month" | "stay" | null;
  currency: string | null;
};

type Row = {
  id: string;
  source_id: string;
  source_name: string;
  source_kind: string;
  type: string;
  title: string;
  city: string | null;
  neighborhood: string | null;
  region: string | null;
  lat: number;
  lng: number;
  location_precision: string | null;
  external_url: string | null;
  rating: number | null;
  max_guests: number | null;
  attributes: Record<string, unknown>;
  price_model: MapListing["priceModel"];
  price_amount_cents: number | null;
  price_period: MapListing["pricePeriod"];
  currency: string | null;
  photo: string | null;
  next_start: string | null;
  next_end: string | null;
};

/** Active listings with coordinates, shaped for the map. Refreshes every minute or so. */
export async function getMapListings(): Promise<MapListing[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("listings");

  const { rows } = await db.execute<Row>(sql`
    select
      l.id, l.source_id, s.name as source_name, s.kind as source_kind, l.type, l.title,
      l.city, l.neighborhood, l.region, l.lat, l.lng, l.location_precision,
      l.external_url, l.rating, l.max_guests, l.attributes,
      l.price_model, l.price_amount_cents, l.price_period, l.currency,
      p.url as photo,
      a.start_date as next_start, a.end_date as next_end
    from listings l
    join sources s on s.id = l.source_id
    left join lateral (
      select url from listing_photos where listing_id = l.id order by position limit 1
    ) p on true
    left join lateral (
      select start_date::text, end_date::text from listing_availability
      where listing_id = l.id and kind = 'available' and end_date >= current_date
      order by start_date limit 1
    ) a on true
    where l.status = 'active' and l.lat is not null and l.lng is not null
  `);

  return spreadStacks(rows).map(({ row, lat, lng, offset }) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceKind: row.source_kind,
    type: row.type,
    title: row.title,
    place: [row.neighborhood ?? row.city, row.region].filter(Boolean).join(", ") || null,
    lat,
    lng,
    approximate: offset || row.location_precision !== "exact",
    url: row.external_url,
    photo: row.photo,
    rating: row.rating ? row.rating : null,
    maxGuests: row.max_guests,
    summary: summarize(row),
    nextAvailable: row.next_start ? { start: row.next_start, end: row.next_end! } : null,
    priceModel: row.price_model,
    priceCents: row.price_model === "paid" && row.price_amount_cents ? row.price_amount_cents : null,
    pricePeriod: row.price_period,
    currency: row.currency,
  }));
}

/**
 * Scraped sources often only give a city centroid, so dozens of listings share one
 * coordinate and would never un-cluster. Fan each stack out in a golden-angle spiral
 * (~150m per ring) so every listing gets its own pin near its true area.
 */
function spreadStacks(rows: Row[]) {
  const stacks = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.lat.toFixed(5)},${row.lng.toFixed(5)}`;
    stacks.set(key, [...(stacks.get(key) ?? []), row]);
  }

  const golden = Math.PI * (3 - Math.sqrt(5));
  const step = 0.0014; // degrees latitude, ~155m
  return [...stacks.values()].flatMap((stack) => {
    if (stack.length === 1) return [{ row: stack[0], lat: stack[0].lat, lng: stack[0].lng, offset: false }];
    // Stable order so pins don't reshuffle between refreshes.
    const sorted = stack.toSorted((a, b) => a.id.localeCompare(b.id));
    return sorted.map((row, i) => {
      const r = step * Math.sqrt(i + 0.5);
      const theta = i * golden;
      const lngScale = Math.cos((row.lat * Math.PI) / 180);
      return {
        row,
        lat: row.lat + r * Math.sin(theta),
        lng: row.lng + (r * Math.cos(theta)) / lngScale,
        offset: true,
      };
    });
  });
}

function summarize(row: Row): string | null {
  const attrs = row.attributes ?? {};
  const animals = attrs.animals;
  if (Array.isArray(animals) && animals.length) {
    return animals
      .map((a: { name?: string; count?: number }) =>
        a.count && a.count > 1 ? `${a.count} ${a.name}s` : `1 ${a.name}`,
      )
      .join(", ");
  }
  const help = attrs.helpTypes ?? attrs.skills;
  const parts = [
    typeof attrs.hoursPerWeek === "number" ? `${attrs.hoursPerWeek}h/week` : null,
    Array.isArray(help) && help.length ? help.slice(0, 3).join(" · ") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
