/**
 * Shared pieces of the stay-search eval: the eval set, candidate pools, the LLM judge (cached in
 * judgments.json) and the metrics. CLIs: judge.ts (build pools + grade) and run.ts (score searches).
 * Read-only on the database.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openai } from "@ai-sdk/openai";
import { neon } from "@neondatabase/serverless";
import { generateText, Output } from "ai";
import { z } from "zod";

export const DIR = path.join(process.cwd(), "tools/search-eval");
const QUERIES_FILE = path.join(DIR, "queries.json");
const JUDGMENTS_FILE = path.join(DIR, "judgments.json");

// ---------------------------------------------------------------------------
// Eval set

/** Same shape as searchStays' input (src/lib/agent/tools.ts). */
export type SearchStaysParams = {
  location?: string;
  radiusKm?: number;
  startDate?: string;
  endDate?: string;
  types?: string[];
  sources?: string[];
  animals?: string[];
  noPets?: boolean;
  keywords?: string;
  limit?: number;
};

/** Only used to gather extra candidates for judging. Search functions must not read it. */
export type PoolHints = {
  near?: { lat: number; lng: number; km: number };
  region?: "CA";
  market?: string;
  types?: string[];
  sources?: string[];
  terms?: string[];
};

export type EvalQuery = {
  id: string;
  /** What the user said. */
  query: string;
  /** What the chat agent would pass to searchStays. */
  params: SearchStaysParams;
  /** What counts as relevant; the judge grades against this. */
  intent: string;
  tags: string[];
  pool: PoolHints;
};

export function loadQueries(): { asOf: string; queries: EvalQuery[] } {
  return JSON.parse(readFileSync(QUERIES_FILE, "utf8"));
}

/**
 * A search under test: return listing ids, best first (the runner reads the top 20).
 * It gets the user's words (`q.query`), the agent's structured params (`q.params`) and `ctx.asOf`
 * (the date the eval treats as "today"). It must not read `q.intent` or `q.pool`.
 */
export type SearchFn = (q: Pick<EvalQuery, "id" | "query" | "params">, ctx: { asOf: string; k: number }) => Promise<string[]>;

// ---------------------------------------------------------------------------
// Database (raw, read-only queries)

let _sql: ReturnType<typeof neon> | null = null;
export function sql() {
  _sql ??= neon(process.env.DATABASE_URL!);
  return _sql;
}
async function q<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql().query(text, params)) as T[];
}

const DOC = `to_tsvector('english', concat_ws(' ', l.title, l.description, l.guest_expectations, l.house_rules, l.attributes::text, array_to_string(l.amenities, ' ')))`;

function poolWhere(h: PoolHints, params: unknown[]) {
  const where = [`l.status = 'active'`, `l.source_id in (select id from sources where enabled)`];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (h.near) {
    where.push(
      `l.lat is not null and (6371 * 2 * asin(sqrt(power(sin(radians(l.lat - ${p(h.near.lat)}) / 2), 2) + cos(radians(${p(h.near.lat)})) * cos(radians(l.lat)) * power(sin(radians(l.lng - ${p(h.near.lng)}) / 2), 2)))) <= ${p(h.near.km)}`,
    );
  }
  if (h.region === "CA") {
    where.push(
      `(l.region ilike 'ca' or l.region ilike 'california' or (l.lat between 32.5 and 42.1 and l.lng between -124.5 and -114.1))`,
    );
  }
  if (h.market) where.push(`l.market = ${p(h.market)}`);
  if (h.types?.length) where.push(`l.type::text = any(${p(h.types)})`);
  if (h.sources?.length) where.push(`l.source_id = any(${p(h.sources)})`);
  return where.join(" and ");
}

/**
 * Extra candidates beyond what the searches return: the best full-text matches for the pool terms
 * inside the pool's area, plus a stable random sample of the area so the judge also sees listings
 * no keyword would find.
 */
export async function poolCandidates(e: EvalQuery, { fts = 25, sample = 8 } = {}) {
  const h = e.pool;
  const tsq = (h.terms ?? []).map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" or ");
  const p1: unknown[] = [];
  const w1 = poolWhere(h, p1);
  p1.push(tsq, e.id);
  const byText = tsq
    ? await q<{ id: string }>(
        `select l.id from listings l where ${w1} and ${DOC} @@ websearch_to_tsquery('english', $${p1.length - 1})
         order by ts_rank(${DOC}, websearch_to_tsquery('english', $${p1.length - 1})) desc, md5(l.id::text || $${p1.length}) limit ${fts}`,
        p1,
      )
    : [];
  const p2: unknown[] = [];
  const w2 = poolWhere(h, p2);
  p2.push(e.id);
  const random = await q<{ id: string }>(
    `select l.id from listings l where ${w2} order by md5(l.id::text || $${p2.length}) limit ${sample}`,
    p2,
  );
  return [...new Set([...byText, ...random].map((r) => r.id))];
}

type CardRow = {
  id: string;
  source_id: string;
  source_name: string;
  type: string;
  title: string;
  description: string | null;
  guest_expectations: string | null;
  house_rules: string | null;
  neighborhood: string | null;
  city: string | null;
  subregion: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  price_model: string;
  price_amount_cents: number | null;
  price_period: string | null;
  currency: string | null;
  max_guests: number | null;
  min_nights: number | null;
  amenities: string[];
  languages: string[];
  attributes: Record<string, unknown>;
  rating: number | null;
  status: string;
  photos: number;
  windows: { s: string; e: string }[] | null;
};

export async function loadCards(ids: string[], asOf: string) {
  if (!ids.length) return new Map<string, CardRow>();
  const rows = await q<CardRow>(
    `select l.id, l.source_id, s.name source_name, l.type, l.title, l.description, l.guest_expectations, l.house_rules,
       l.neighborhood, l.city, l.subregion, l.region, l.lat, l.lng, l.price_model, l.price_amount_cents, l.price_period,
       l.currency, l.max_guests, l.min_nights, l.amenities, l.languages, l.attributes, l.rating, l.status,
       (select count(*)::int from listing_photos p where p.listing_id = l.id) photos,
       (select json_agg(json_build_object('s', a.start_date, 'e', a.end_date) order by a.start_date)
          from (select * from listing_availability a where a.listing_id = l.id and a.kind = 'available'
                and a.end_date >= $2::date and coalesce((a.attributes->>'confirmed')::boolean, false) = false
                order by a.start_date limit 6) a) windows
     from listings l join sources s on s.id = l.source_id where l.id = any($1)`,
    [ids, asOf],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

const NOISY_KEYS = new Set([
  "priceSeenAt", "searchArea", "searchFilter", "postId", "hostelworldId", "feed", "unitCode", "listingNumber",
  "propertyId", "roomId", "searchPages", "testimonials", "reviews", "ratingBreakdown", "cardTitle", "badges",
  "geocodedFrom", "coordsFrom", "pinDiscarded", "locationFromStateCentroid", "hostelCode", "faqUrl", "bookingUrl",
  "videoUrl", "vrUrl", "groupId", "summaryIsAiGenerated", "contentHash",
]);

function clip(s: string | null | undefined, n: number) {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function compactAttrs(a: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a ?? {})) {
    if (NOISY_KEYS.has(k) || v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[k] = typeof v === "string" ? clip(v, 220) : Array.isArray(v) ? v.slice(0, 12) : v;
  }
  return clip(JSON.stringify(out), 1000);
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** The listing as the judge sees it: text and structured facts, no photos. */
export function cardText(r: CardRow, near?: { lat: number; lng: number }) {
  const price =
    r.price_model === "paid"
      ? r.price_amount_cents
        ? `paid, ${(r.price_amount_cents / 100).toFixed(0)} ${r.currency ?? "USD"} per ${r.price_period ?? "?"}`
        : "paid (amount unknown)"
      : r.price_model; // free | exchange
  const place = [r.neighborhood, r.city, r.subregion, r.region].filter(Boolean).join(", ") || "unknown";
  const dist = near && r.lat != null && r.lng != null ? ` (~${haversine(near, { lat: r.lat, lng: r.lng }).toFixed(0)} km from the requested area's center)` : "";
  const windows = r.windows?.length ? r.windows.map((w) => `${w.s}..${w.e}`).join(", ") : "none listed";
  return [
    `title: ${clip(r.title, 160)}`,
    `source: ${r.source_name} | type: ${r.type} | price: ${price}`,
    `location: ${place}${dist}`,
    `open dates: ${windows}`,
    r.max_guests || r.min_nights ? `max guests: ${r.max_guests ?? "?"} | min nights: ${r.min_nights ?? "?"}` : "",
    `description: ${clip(r.description, 900) || "(none)"}`,
    r.guest_expectations ? `guest expectations: ${clip(r.guest_expectations, 400)}` : "",
    r.house_rules ? `house rules: ${clip(r.house_rules, 250)}` : "",
    r.amenities?.length ? `amenities: ${clip(r.amenities.slice(0, 20).join(", "), 300)}` : "",
    r.languages?.length ? `languages: ${r.languages.join(", ")}` : "",
    `attributes: ${compactAttrs(r.attributes)}`,
    r.status !== "active" ? `STATUS: ${r.status}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// LLM judge, cached

export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "gpt-5.4-mini";
const RUBRIC_VERSION = "v1";
/** Assumed list price for the cost estimate (USD per 1M tokens); adjust if the model changes. */
const PRICE = { input: 0.75, output: 4.5 };

const SYSTEM = `You grade search results for AgentBnB, a personal agent that finds people free or cheap places to stay (couches, spare rooms, house sits, work exchanges, farm stays, home swaps, plus some rentals and hostels).
For each listing, grade how well it satisfies the user's request:
3 = excellent: right place, right kind of stay, and it meets the request's key needs (dates, pets, skills, budget, vibe, who it's for).
2 = good: right place and kind of stay; one secondary need is unknown or slightly off (e.g. dates not listed, price a bit high).
1 = marginal: related but a clear mismatch on something that matters (wrong area, wrong kind of stay, outside the dates, over budget, missing the key requirement).
0 = not relevant, wrong location, junk, or contradicts the request (e.g. has cats when the user is allergic).
Rules: location matters most; judge it from the location fields and the description. "open dates: none listed" means dates are unknown (not a mismatch by itself, but it can't be 3 if the user needs specific dates). Use only the listing's text and attributes; don't assume facts that aren't there. Give a short reason (max 15 words).`;

export type Grade = { g: number; why: string };
type Judgments = {
  model: string;
  rubric: string;
  usage: { calls: number; inputTokens: number; outputTokens: number };
  queries: Record<string, { hash: string; grades: Record<string, Grade> }>;
};

export function loadJudgments(): Judgments {
  if (!existsSync(JUDGMENTS_FILE))
    return { model: JUDGE_MODEL, rubric: RUBRIC_VERSION, usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, queries: {} };
  return JSON.parse(readFileSync(JUDGMENTS_FILE, "utf8"));
}
export function saveJudgments(j: Judgments) {
  // Stable key order keeps diffs readable.
  const queries = Object.fromEntries(
    Object.entries(j.queries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, { hash: v.hash, grades: Object.fromEntries(Object.entries(v.grades).sort(([a], [b]) => a.localeCompare(b))) }]),
  );
  writeFileSync(JUDGMENTS_FILE, JSON.stringify({ ...j, queries }, null, 1) + "\n");
}

function queryHash(e: EvalQuery) {
  return createHash("sha1").update([RUBRIC_VERSION, e.query, e.intent].join("\n")).digest("hex").slice(0, 12);
}

/** Grades for one query; drops stale ones if the query or intent changed. */
export function gradesFor(j: Judgments, e: EvalQuery) {
  const entry = j.queries[e.id];
  if (!entry || entry.hash !== queryHash(e)) {
    j.queries[e.id] = { hash: queryHash(e), grades: {} };
  }
  return j.queries[e.id].grades;
}

export function costUSD(u: Judgments["usage"]) {
  return (u.inputTokens * PRICE.input + u.outputTokens * PRICE.output) / 1e6;
}

const gradeSchema = z.object({
  grades: z.array(
    z.object({ key: z.string(), grade: z.number().int().min(0).max(3), reason: z.string() }),
  ),
});

/** Grade every listing id not yet judged for this query. Batches of 8 per call. */
export async function judgeMissing(j: Judgments, e: EvalQuery, ids: string[], asOf: string, log = console.log) {
  const grades = gradesFor(j, e);
  const todo = [...new Set(ids)].filter((id) => !grades[id]);
  if (!todo.length) return 0;
  const cards = await loadCards(todo, asOf);
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += 8) batches.push(todo.slice(i, i + 8));
  const weekday = new Date(`${asOf}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

  await mapLimit(batches, 6, async (batch) => {
    const keyed = batch.filter((id) => cards.has(id)).map((id, i) => ({ id, key: `L${i + 1}` }));
    for (const id of batch) if (!cards.has(id)) grades[id] = { g: 0, why: "listing no longer exists" };
    if (!keyed.length) return;
    const prompt = [
      `Today is ${weekday} ${asOf}.`,
      `User request: "${e.query}"`,
      `What counts as relevant: ${e.intent}`,
      "",
      ...keyed.map(({ id, key }) => `### ${key}\n${cardText(cards.get(id)!, e.pool.near)}`),
      "",
      `Grade every listing (${keyed.map((k) => k.key).join(", ")}).`,
    ].join("\n");
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await generateText({
          model: openai(JUDGE_MODEL),
          providerOptions: { openai: { reasoningEffort: "low" } },
          system: SYSTEM,
          prompt,
          output: Output.object({ schema: gradeSchema }),
        });
        j.usage.calls++;
        j.usage.inputTokens += r.usage.inputTokens ?? 0;
        j.usage.outputTokens += r.usage.outputTokens ?? 0;
        for (const { id, key } of keyed) {
          const g = r.output.grades.find((x) => x.key === key);
          if (g) grades[id] = { g: g.grade, why: g.reason };
        }
        return;
      } catch (err) {
        if (attempt >= 3) {
          log(`  judge failed for ${e.id}: ${(err as Error).message}`);
          return;
        }
      }
    }
  });
  return todo.length;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Listings a search could legitimately return today: active, from an enabled source. Judged listings
 * outside this set (gone, or a hidden network) are dropped from the ideal ranking.
 */
export async function searchableIds() {
  const rows = await q<{ id: string }>(
    `select l.id from listings l join sources s on s.id = l.source_id where l.status = 'active' and s.enabled`,
  );
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Metrics. Relevant = grade >= 2. Unjudged results count as 0 (reported as "holes").

export const REL = 2;
const gain = (g: number) => 2 ** g - 1;

export function scoreQuery(ranked: string[], grades: Record<string, Grade>) {
  const g = (id: string) => grades[id]?.g ?? 0;
  const allGrades = Object.values(grades).map((x) => x.g);
  const relevantTotal = allGrades.filter((x) => x >= REL).length;
  const ideal = allGrades.toSorted((a, b) => b - a).slice(0, 10);
  const idcg = ideal.reduce((s, x, i) => s + gain(x) / Math.log2(i + 2), 0);
  const dcg = ranked.slice(0, 10).reduce((s, id, i) => s + gain(g(id)) / Math.log2(i + 2), 0);
  const top5 = ranked.slice(0, 5);
  return {
    returned: ranked.length,
    ndcg10: idcg > 0 ? dcg / idcg : null,
    p5: relevantTotal > 0 ? top5.filter((id) => g(id) >= REL).length / 5 : null,
    r20: relevantTotal > 0 ? ranked.slice(0, 20).filter((id) => g(id) >= REL).length / relevantTotal : null,
    relevantTotal,
    holes10: ranked.slice(0, 10).filter((id) => !grades[id]).length,
    /** For queries where nothing should match: share of the top 10 that is junk (grade 0). */
    junk10: ranked.length ? ranked.slice(0, 10).filter((id) => g(id) === 0).length / Math.min(10, ranked.length) : 0,
  };
}

export const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
