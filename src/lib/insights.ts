// AI read of every listing, for search: one structured call per listing to a small vision model
// (its text plus up to 4 photos), then an embedding over a compact text built from the result.
// Results go to listing_insights only; listings is never written. Idempotent: `contentHash`
// covers the model input, so unchanged listings are skipped.
//
// Entry points:
//   analyzeListingIds(ids)   analyze + embed specific listings (e.g. right after an ingest)
//   runInsights(options)     the batch pipeline behind `pnpm analyze` (scripts/analyze-listings.ts)

import { createHash } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { embedMany, generateText, Output, type FilePart, type TextPart } from "ai";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type SharpFn from "sharp";
import { z } from "zod";
import { db } from "@/db";
import {
  listingInsights,
  listingPhotos,
  listings,
  sources,
  type ListingFeatures,
  type PhotoNotes,
} from "@/db/schema";
import { QUALITY_FLAGS, STAY_KINDS, TAG_LIST, tagGuide, type Tag } from "./insights-vocabulary";

/** Small, cheap, vision-capable. $0.10 / 1M input, $0.01 cached, $0.50 output (Oct 2026). */
export const INSIGHTS_MODEL = process.env.INSIGHTS_MODEL ?? "gpt-6-luna";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
/** Bump to re-analyze everything after a prompt or schema change. */
const PROMPT_VERSION = 1;
const MAX_PHOTOS = 4;
const PHOTO_EDGE = 512;

/** USD per 1M tokens, for the cost tally. */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "text-embedding-3-small": { input: 0.02, cached: 0.02, output: 0 },
};

function costUsd(model: string, input: number, cached: number, output: number) {
  const p = PRICES[model];
  if (!p) return 0;
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1e6;
}

// ---------------------------------------------------------------------------
// Prompt and output schema
// ---------------------------------------------------------------------------

const SYSTEM = `You analyze listings for AgentBnB, an agent that finds people a place to stay: couches, spare rooms, house sits, work exchanges, farm stays, home swaps, rentals and hostels. Your output feeds search, so it must be accurate and literal. Never invent facts: if the listing doesn't say it and the photos don't show it, leave it out or use null.

Write for a guest deciding whether to stay there.

summary: 2-3 plain sentences. What the stay is, where, and what's notable (the deal, the animals or work, the space, the setting). Neutral and honest: no marketing words ("stunning", "oasis"), no exclamation marks, no repeating the title. Don't mention the source site. If the listing is thin or looks like junk, say what little is known.

tags: only from the vocabulary below, only when the text or photos support it. Usually 4-12 tags. Rules:
- room:entire_place for house sits, home swaps, and whole-unit rentals; room:private / room:shared / bed:dorm / bed:couch for the rest.
- price:free for house sits, home swaps and unpaid exchanges; never for paid rentals.
- pets:* means animals that live there, not ones the guest may bring (that's pets:guest_pets_ok).
- view:* only if the text says so or a photo clearly shows it.
- near:* only if the text mentions it or the location makes it obvious (a beach town street, "2 blocks to BART").
- help:* only when the guest works or helps in exchange for the stay (help:hostel = the guest works at a hostel; never for someone just booking a hostel bed).
- Exactly one setting:* tag, matching features.place.setting.
- wifi only if internet is mentioned; workspace:desk only if a desk/office/workspace is mentioned or visible. good_for:remote_work only with internet plus a place to work, and not if the listing says the schedule or connection won't allow it.
- furnished only if the guest's own room or unit is furnished.
- kids only if children are explicitly welcome or it's set up for families.
- women_only if the listing restricts or strongly prefers women.
- When structured details (amenities, "Other details") contradict the description, trust the description.

Vocabulary:
${tagGuide()}

kind: the arrangement. If the guest pays rent it's entire_place, private_room, shared_room, dorm_bed or couch, even when pet care or chores are part of it. house_sit only when the guest stays free (or nearly) in exchange for minding the home or pets. home_swap for swaps and hospitality-point exchanges. work_exchange / farm_stay when the guest works for the bed. camping for tents, RVs and land-only stays.

features: structured facts. pets: null if no animals live there; use "unknown" for an animal whose species isn't stated, never guess. work: null unless the guest is expected to work or help (house sits count: tasks like "walk dog twice a day"). hoursPerWeek only if stated or clearly derivable ("4h/day, 5 days" = 20). place.setting from the location and text. vibe: 1-4 short lowercase words. houseRules: one short line or null. minStay: e.g. "2 weeks", "1 month", or null. bestFor: 1-3 short phrases ("remote worker", "family with kids", "animal lover"). redFlags: real safety or scam concerns only (asks for a deposit or payment outside the platform, pushes contact to email/WhatsApp, too good to be true, unsafe conditions, the host's terms contradict each other on something that matters like price or dates); not minor inconsistencies, and never dates or fields from "Other details" (those can be scrape artifacts). Usually empty.

quality: 0-1, how complete and appealing the listing is for a guest. 0.8+ detailed text, real photos, clear terms. 0.5 usable but thin. 0.2 or less: empty, placeholder photos, spammy, a duplicate of other listings, or not really a stay. qualityFlags explain any low score.

photos: null when no photos are attached. Otherwise describe only what is visible: overall (one sentence), light, condition (e.g. "clean, recently renovated", "dated but tidy", "cluttered"), style, view, outdoor; null for any you can't tell. captions: one short caption per attached photo, in order (max 12 words each). Placeholder, logo or map images: say so in the caption and add placeholder_photos to qualityFlags.`;

const nullableString = z.string().nullable();

const analysisSchema = z.object({
  summary: z.string(),
  kind: z.enum(STAY_KINDS),
  tags: z.array(z.enum(TAG_LIST)),
  pets: z
    .object({
      kinds: z.array(z.enum(["dog", "cat", "horse", "farm_animals", "small_animals", "unknown"])),
      count: z.number().int().nullable(),
      needs: nullableString.describe("Care the animals need, one short line"),
    })
    .nullable(),
  work: z
    .object({
      hoursPerWeek: z.number().nullable(),
      tasks: z.array(z.string()),
      skills: z.array(z.string()),
      perks: z.array(z.string()),
    })
    .nullable(),
  place: z.object({
    privateRoom: z.boolean().nullable(),
    privateBath: z.boolean().nullable(),
    bedrooms: z.number().int().nullable(),
    beds: z.number().int().nullable(),
    workspace: z.boolean().nullable(),
    outdoor: z.array(z.string()).describe("e.g. garden, deck, pool, land, rooftop"),
    setting: z.enum(["urban", "suburban", "small_town", "rural", "remote"]).nullable(),
  }),
  vibe: z.array(z.string()),
  houseRules: nullableString,
  minStay: nullableString,
  bestFor: z.array(z.string()),
  redFlags: z.array(z.string()),
  quality: z.number(),
  qualityFlags: z.array(z.enum(QUALITY_FLAGS)),
  photos: z
    .object({
      overall: nullableString,
      light: nullableString,
      condition: nullableString,
      style: nullableString,
      view: nullableString,
      outdoor: nullableString,
      captions: z.array(z.string()),
    })
    .nullable(),
});

export type ListingAnalysis = z.infer<typeof analysisSchema>;

// ---------------------------------------------------------------------------
// Loading listings and building the model input
// ---------------------------------------------------------------------------

export type ListingForAnalysis = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  sourceBaseUrl: string | null;
  type: string;
  title: string;
  description: string | null;
  guestExpectations: string | null;
  houseRules: string | null;
  neighborhood: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  locationPrecision: string | null;
  maxGuests: number | null;
  minNights: number | null;
  maxNights: number | null;
  priceModel: string;
  priceAmountCents: number | null;
  pricePeriod: string | null;
  currency: string | null;
  amenities: string[];
  languages: string[];
  attributes: Record<string, unknown>;
  rating: number | null;
  /** Other active listings with the same opening text. */
  duplicates: number;
  photoUrls: string[];
  existingHash: string | null;
  existingPhotoStatus: string | null;
};

type LoadFilter = { ids?: string[]; sourceId?: string; limit?: number };

/** Active listings (or the given ids), with their photos and current insight hash. */
export async function loadListings(filter: LoadFilter = {}): Promise<ListingForAnalysis[]> {
  // Only listings from enabled sources: hidden sources aren't searched, so don't pay to analyze them.
  const conds = [eq(listings.status, "active"), eq(sources.enabled, true)];
  if (filter.ids) conds.push(inArray(listings.id, filter.ids));
  if (filter.sourceId) conds.push(eq(listings.sourceId, filter.sourceId));

  // Exact-duplicate opening text across active listings (reposts, the same home on two sites).
  const dupKey = sql`md5(lower(regexp_replace(left(coalesce(${listings.description}, ''), 400), '\\s+', ' ', 'g')))`;
  const dups = db.$with("dups").as(
    db
      .select({ key: sql<string>`${dupKey}`.as("key"), n: sql<number>`count(*)::int`.as("n") })
      .from(listings)
      .where(and(eq(listings.status, "active"), sql`length(coalesce(${listings.description}, '')) > 80`))
      .groupBy(sql`1`),
  );

  let q = db
    .with(dups)
    .select({
      l: listings,
      sourceName: sources.name,
      sourceKind: sources.kind,
      sourceBaseUrl: sources.baseUrl,
      duplicates: sql<number>`coalesce(${dups.n}, 1) - 1`,
      existingHash: listingInsights.contentHash,
      existingPhotoStatus: listingInsights.photoStatus,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .leftJoin(listingInsights, eq(listingInsights.listingId, listings.id))
    .leftJoin(dups, sql`${dups.key} = ${dupKey}`)
    .where(and(...conds))
    .orderBy(listings.id)
    .$dynamic();
  if (filter.limit) q = q.limit(filter.limit);
  const rows = await q;
  if (!rows.length) return [];

  const photos = await loadPhotos(rows.map((r) => r.l.id));
  const noisyAmenities = await sourcesWithConstantAmenities();
  return rows.map(({ l, ...r }) => ({
    id: l.id,
    sourceId: l.sourceId,
    sourceName: r.sourceName,
    sourceKind: r.sourceKind,
    sourceBaseUrl: r.sourceBaseUrl,
    type: l.type,
    title: l.title,
    description: l.description,
    guestExpectations: l.guestExpectations,
    houseRules: l.houseRules,
    neighborhood: l.neighborhood,
    city: l.city,
    region: l.region,
    countryCode: l.countryCode,
    locationPrecision: l.locationPrecision,
    maxGuests: l.maxGuests,
    minNights: l.minNights,
    maxNights: l.maxNights,
    priceModel: l.priceModel,
    priceAmountCents: l.priceAmountCents,
    pricePeriod: l.pricePeriod,
    currency: l.currency,
    amenities: noisyAmenities.has(l.sourceId) ? [] : l.amenities,
    languages: l.languages,
    attributes: l.attributes,
    rating: l.rating,
    duplicates: Number(r.duplicates) || 0,
    photoUrls: photos.get(l.id) ?? [],
    existingHash: r.existingHash,
    existingPhotoStatus: r.existingPhotoStatus,
  }));
}

/**
 * Sources whose listings all carry the exact same amenity list: a scraper picking up every icon
 * rather than the ones that apply (Workaway). Those amenities say nothing, so the model doesn't see them.
 */
async function sourcesWithConstantAmenities() {
  const rows = await db
    .select({ sourceId: listings.sourceId })
    .from(listings)
    .where(and(eq(listings.status, "active"), sql`cardinality(${listings.amenities}) > 0`))
    .groupBy(listings.sourceId)
    .having(sql`count(*) >= 10 and count(distinct ${listings.amenities}) = 1`);
  return new Set(rows.map((r) => r.sourceId));
}

async function loadPhotos(ids: string[]) {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db
      .select({ listingId: listingPhotos.listingId, url: listingPhotos.url })
      .from(listingPhotos)
      .where(and(inArray(listingPhotos.listingId, chunk), sql`${listingPhotos.position} < 8`))
      .orderBy(listingPhotos.listingId, listingPhotos.position);
    for (const r of rows) {
      if (!usablePhotoUrl(r.url)) continue;
      const list = out.get(r.listingId) ?? [];
      list.push(r.url);
      out.set(r.listingId, list);
    }
  }
  return out;
}

/** Skips relative paths and the "no image" placeholders some sources use. */
function usablePhotoUrl(url: string) {
  return /^https?:\/\//.test(url) && !/placeholder|no[-_]?image|no_house|default[-_]?(listing|photo)/i.test(url);
}

/** Attribute keys that are bookkeeping or duplicate other fields. */
const NOISY_ATTRIBUTES = new Set([
  "taxes",
  "searchFilter",
  "searchArea",
  "priceSeenAt",
  "amenitiesFrom",
  "postId",
  "expiresAt",
  "updatedAt",
  "postedAt",
  "hostelworldId",
  "facilities",
  "checkIn",
  "checkOut",
  "nights",
  "totalPrice",
  "originalTotalPrice",
  "priceFromTotal",
  "priceIncludesFees",
  "summaryIsAiGenerated",
  "detailAvailable",
  "photos",
  "images",
  "url",
  "slug",
]);

/** Attributes without empty values, long strings or bookkeeping, capped in size. */
function compactAttributes(attrs: Record<string, unknown>) {
  const clean = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined || v === "") return undefined;
    if (typeof v === "string") return v.length > 400 ? `${v.slice(0, 400)}…` : v;
    if (Array.isArray(v)) {
      const items = v.slice(0, 15).map((x) => clean(x, depth + 1)).filter((x) => x !== undefined);
      return items.length ? items : undefined;
    }
    if (typeof v === "object") {
      if (depth > 2) return undefined;
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (NOISY_ATTRIBUTES.has(k)) continue;
        const c = clean(x, depth + 1);
        if (c !== undefined) o[k] = c;
      }
      return Object.keys(o).length ? o : undefined;
    }
    return v;
  };
  const json = JSON.stringify(clean(attrs, 0) ?? {});
  return json.length > 2500 ? `${json.slice(0, 2500)}…` : json;
}

function clip(s: string | null, max: number) {
  if (!s) return null;
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function priceLine(l: ListingForAnalysis) {
  if (l.priceModel === "free") return "free";
  if (l.priceModel === "exchange") return "exchange (no rent; work, care or a home swap)";
  if (l.priceAmountCents == null) return "paid (amount not listed)";
  return `${(l.priceAmountCents / 100).toFixed(0)} ${l.currency ?? "USD"} per ${l.pricePeriod ?? "stay"}`;
}

/** The listing as text for the model. */
export function listingText(l: ListingForAnalysis) {
  const lines = [
    `Source: ${l.sourceName} (${l.sourceKind})`,
    `Listing type: ${l.type}`,
    `Title: ${l.title}`,
    `Location: ${[l.neighborhood, l.city, l.region, l.countryCode].filter(Boolean).join(", ") || "unknown"}`,
    `Price: ${priceLine(l)}`,
  ];
  const stay = [
    l.maxGuests != null && `max ${l.maxGuests} guests`,
    l.minNights != null && `min ${l.minNights} nights`,
    l.maxNights != null && `max ${l.maxNights} nights`,
  ].filter(Boolean);
  if (stay.length) lines.push(`Stay: ${stay.join(", ")}`);
  if (l.rating != null) lines.push(`Rating: ${l.rating}`);
  if (l.amenities.length) lines.push(`Amenities: ${l.amenities.slice(0, 40).join(", ")}`);
  if (l.languages.length) lines.push(`Languages: ${l.languages.join(", ")}`);
  const description = clip(l.description, 3500);
  lines.push(`Description: ${description ?? "(none)"}`);
  const expectations = clip(l.guestExpectations, 1500);
  if (expectations) lines.push(`What the guest is expected to do: ${expectations}`);
  const rules = clip(l.houseRules, 1000);
  if (rules) lines.push(`House rules: ${rules}`);
  lines.push(`Other details: ${compactAttributes(l.attributes)}`);
  if (l.duplicates > 0) lines.push(`Note: ${l.duplicates} other listing(s) open with exactly the same text.`);
  return lines.join("\n");
}

/** Hash of everything that goes into the model call. Photo bytes aren't included, only their URLs. */
export function inputHash(l: ListingForAnalysis) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: PROMPT_VERSION,
        model: INSIGHTS_MODEL,
        system: SYSTEM,
        text: listingText(l),
        photos: l.photoUrls.slice(0, MAX_PHOTOS + 2),
      }),
    )
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

type Sharp = typeof SharpFn;
let sharpModule: Sharp | null | undefined;
async function loadSharp() {
  if (sharpModule === undefined) {
    sharpModule = await import("sharp").then((m) => m.default).catch(() => null);
  }
  return sharpModule;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

/** Downloads and shrinks one photo to a small JPEG. Null when the CDN refuses or it isn't a real photo. */
async function fetchPhoto(url: string, referer: string | null): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "image/*", ...(referer ? { referer } : {}) },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/") && !type.includes("octet-stream")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2_000 || buf.length > 25_000_000) return null;
    const sharp = await loadSharp();
    if (!sharp) return buf;
    const img = sharp(buf, { failOn: "none" });
    const meta = await img.metadata();
    if ((meta.width ?? 0) < 160 || (meta.height ?? 0) < 120) return null; // icons, logos, placeholders
    return await img
      .rotate()
      .resize({ width: PHOTO_EDGE, height: PHOTO_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
  } catch {
    return null;
  }
}

async function fetchPhotos(l: ListingForAnalysis) {
  const referer = l.sourceBaseUrl ? new URL("/", l.sourceBaseUrl).toString() : null;
  const candidates = l.photoUrls.slice(0, MAX_PHOTOS + 2);
  const results = await Promise.all(candidates.map((u) => fetchPhoto(u, referer)));
  const ok: { url: string; data: Buffer }[] = [];
  results.forEach((data, i) => {
    if (data && ok.length < MAX_PHOTOS) ok.push({ url: candidates[i], data });
  });
  return { ok, attempted: candidates.length };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export type Usage = { inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number };

export type AnalyzedListing = {
  listingId: string;
  analysis: ListingAnalysis;
  photoStatus: "analyzed" | "text_only" | "no_photos";
  photoUrls: string[];
  contentHash: string;
  usage: Usage;
};

/** One structured call: listing text plus up to 4 small photos. */
export async function analyzeListing(l: ListingForAnalysis): Promise<AnalyzedListing> {
  const contentHash = inputHash(l);
  const { ok: photos, attempted } = l.photoUrls.length ? await fetchPhotos(l) : { ok: [], attempted: 0 };
  const photoStatus = photos.length ? "analyzed" : attempted ? "text_only" : "no_photos";

  const content: (TextPart | FilePart)[] = [
    {
      type: "text",
      text:
        listingText(l) +
        (photos.length
          ? `\n\n${photos.length} photo(s) attached, in order.`
          : attempted
            ? "\n\nThe listing has photos but they couldn't be loaded; set photos to null and don't penalize quality for missing photos."
            : "\n\nThe listing has no photos."),
    },
    ...photos.map(
      (p): FilePart => ({
        type: "file",
        mediaType: "image/jpeg",
        data: p.data,
        providerOptions: { openai: { imageDetail: "low" } },
      }),
    ),
  ];

  const result = await generateText({
    model: openai(INSIGHTS_MODEL),
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output: Output.object({ schema: analysisSchema }),
    maxRetries: 5,
    providerOptions: { openai: { reasoningEffort: "low", reasoningSummary: null } },
  });

  const analysis = tidy(result.output, l, photos.length);
  const input = result.usage.inputTokens ?? 0;
  const cached = result.usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const output = result.usage.outputTokens ?? 0;
  return {
    listingId: l.id,
    analysis,
    photoStatus,
    photoUrls: photos.map((p) => p.url),
    contentHash,
    usage: {
      inputTokens: input,
      cachedTokens: cached,
      outputTokens: output,
      costUsd: costUsd(INSIGHTS_MODEL, input, cached, output),
    },
  };
}

/** Deterministic fixes on top of the model's answer. */
function tidy(a: ListingAnalysis, l: ListingForAnalysis, photoCount: number): ListingAnalysis {
  const tags = new Set<Tag>(a.tags);
  // Paid listings are never free, whatever the text says about "free wifi".
  if (l.priceModel === "paid") tags.delete("price:free");
  if (l.priceModel === "paid") tags.delete("help:hostel");
  for (const kind of a.pets?.kinds ?? []) if (kind !== "unknown") tags.add(`pets:${kind}` as Tag);
  // One setting tag, the same as features.place.setting.
  for (const t of [...tags]) if (t.startsWith("setting:")) tags.delete(t);
  if (a.place.setting) tags.add(`setting:${a.place.setting}` as Tag);
  const flags = new Set(a.qualityFlags);
  if (!l.photoUrls.length) flags.add("no_photos");
  if (l.duplicates > 0) flags.add("duplicate_text");
  return {
    ...a,
    tags: [...tags].sort(),
    quality: Math.round(Math.min(1, Math.max(0, a.quality)) * 100) / 100,
    qualityFlags: [...flags],
    photos: photoCount ? a.photos : null,
  };
}

// ---------------------------------------------------------------------------
// Saving and embedding
// ---------------------------------------------------------------------------

function toRow(r: AnalyzedListing) {
  const { analysis: a } = r;
  const features: ListingFeatures = {
    kind: a.kind,
    pets: a.pets,
    work: a.work,
    place: a.place,
    vibe: a.vibe,
    houseRules: a.houseRules,
    minStay: a.minStay,
    bestFor: a.bestFor,
    redFlags: a.redFlags,
    qualityFlags: a.qualityFlags,
  };
  const photoNotes: PhotoNotes | null = a.photos
    ? {
        overall: a.photos.overall,
        light: a.photos.light,
        condition: a.photos.condition,
        style: a.photos.style,
        view: a.photos.view,
        outdoor: a.photos.outdoor,
        captions: a.photos.captions.slice(0, r.photoUrls.length).map((caption, i) => ({ url: r.photoUrls[i], caption })),
      }
    : null;
  return {
    listingId: r.listingId,
    summary: a.summary,
    tags: a.tags,
    features,
    photoNotes,
    photoStatus: r.photoStatus,
    quality: a.quality,
    embedding: null,
    embeddingText: null,
    model: INSIGHTS_MODEL,
    contentHash: r.contentHash,
    usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: r.usage.costUsd },
    analyzedAt: new Date(),
  };
}

export async function saveInsight(r: AnalyzedListing) {
  const row = toRow(r);
  const { listingId: _id, ...set } = row;
  await db.insert(listingInsights).values(row).onConflictDoUpdate({ target: listingInsights.listingId, set });
}

const KIND_LABEL: Record<string, string> = {
  couch: "couch",
  private_room: "private room",
  shared_room: "shared room",
  dorm_bed: "hostel dorm bed",
  entire_place: "entire place",
  house_sit: "house sit",
  work_exchange: "work exchange",
  farm_stay: "farm stay",
  home_swap: "home swap",
  camping: "camping / rustic stay",
};

/** The text we embed: what a guest's query should land on. Short, dense, no boilerplate. */
export function buildEmbeddingText(
  l: { title: string; city: string | null; neighborhood: string | null; region: string | null },
  i: { summary: string; tags: string[]; features: ListingFeatures; photoNotes: PhotoNotes | null },
) {
  const f = i.features;
  const where = [l.neighborhood, l.city, l.region].filter(Boolean).join(", ");
  const parts = [
    `${l.title}.`,
    `${KIND_LABEL[f.kind] ?? f.kind}${where ? ` in ${where}` : ""}.`,
    i.summary,
    `Tags: ${i.tags.map((t) => t.replace(/[:_]/g, " ")).join(", ")}.`,
  ];
  if (f.pets?.kinds.length) {
    parts.push(`Animals: ${f.pets.count ? `${f.pets.count} ` : ""}${f.pets.kinds.join(", ")}${f.pets.needs ? ` (${f.pets.needs})` : ""}.`);
  }
  if (f.work && (f.work.tasks.length || f.work.hoursPerWeek)) {
    parts.push(
      `Help: ${f.work.tasks.join(", ")}${f.work.hoursPerWeek ? `, ${f.work.hoursPerWeek} h/week` : ""}${f.work.perks.length ? `; offers ${f.work.perks.join(", ")}` : ""}.`,
    );
  }
  const place = [
    f.place.setting,
    f.place.privateRoom ? "private room" : null,
    f.place.privateBath ? "private bath" : null,
    f.place.workspace ? "workspace" : null,
    ...f.place.outdoor,
  ].filter(Boolean);
  if (place.length) parts.push(`Place: ${place.join(", ")}.`);
  if (f.vibe.length) parts.push(`Vibe: ${f.vibe.join(", ")}.`);
  if (f.bestFor.length) parts.push(`Best for: ${f.bestFor.join(", ")}.`);
  const p = i.photoNotes;
  if (p) {
    const notes = [p.overall, p.view && `view: ${p.view}`, p.outdoor && `outdoor: ${p.outdoor}`].filter(Boolean);
    if (notes.length) parts.push(`Photos: ${notes.join("; ")}.`);
  }
  return parts
    .join(" ")
    .replace(/_/g, " ")
    .replace(/\.(\s*\.)+/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

/** Embeds every insight row that has no embedding yet (or only `ids`). Returns rows embedded and cost. */
export async function embedPending(opts: { ids?: string[]; batchSize?: number; log?: (s: string) => void } = {}) {
  const batchSize = opts.batchSize ?? 64;
  let embedded = 0;
  let tokens = 0;
  for (;;) {
    const conds = [isNull(listingInsights.embedding)];
    if (opts.ids) conds.push(inArray(listingInsights.listingId, opts.ids));
    const rows = await db
      .select({
        listingId: listingInsights.listingId,
        summary: listingInsights.summary,
        tags: listingInsights.tags,
        features: listingInsights.features,
        photoNotes: listingInsights.photoNotes,
        title: listings.title,
        city: listings.city,
        neighborhood: listings.neighborhood,
        region: listings.region,
      })
      .from(listingInsights)
      .innerJoin(listings, eq(listings.id, listingInsights.listingId))
      .where(and(...conds))
      .limit(batchSize);
    if (!rows.length) break;

    const texts = rows.map((r) => buildEmbeddingText(r, r));
    const { embeddings, usage } = await embedMany({
      model: openai.embedding(EMBEDDING_MODEL),
      values: texts,
      maxRetries: 5,
    });
    tokens += usage.tokens;

    const values = sql.join(
      rows.map((r, i) => sql`(${r.listingId}::uuid, ${JSON.stringify(embeddings[i])}::vector, ${texts[i]})`),
      sql`, `,
    );
    await db.execute(sql`
      update listing_insights as li
      set embedding = v.embedding, embedding_text = v.text
      from (values ${values}) as v(listing_id, embedding, text)
      where li.listing_id = v.listing_id`);
    embedded += rows.length;
    opts.log?.(`embedded ${embedded}`);
    if (rows.length < batchSize) break;
  }
  return { embedded, tokens, costUsd: costUsd(EMBEDDING_MODEL, tokens, 0, 0) };
}

/** Embeds a search query with the same model, for vector similarity against listing_insights. */
export async function embedQuery(text: string) {
  const { embeddings } = await embedMany({ model: openai.embedding(EMBEDDING_MODEL), values: [text] });
  return embeddings[0];
}

// ---------------------------------------------------------------------------
// Batch pipeline
// ---------------------------------------------------------------------------

export type RunOptions = LoadFilter & {
  /** Random sample: this many listings from each source (for trying prompt changes). */
  perSource?: number;
  concurrency?: number;
  dryRun?: boolean;
  /** Also redo rows whose photos couldn't be fetched last time. */
  retryTextOnly?: boolean;
  /** Re-analyze even when the content hash matches. */
  force?: boolean;
  log?: (s: string) => void;
};

export type RunStats = {
  candidates: number;
  skipped: number;
  analyzed: number;
  textOnly: number;
  noPhotos: number;
  failed: { id: string; error: string }[];
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  analysisCostUsd: number;
  embedded: number;
  embeddingCostUsd: number;
  seconds: number;
};

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i + Math.random() * 1000));
    }
  }
}

/** Analyze (skipping unchanged listings), save each as it finishes, then embed. Safe to interrupt and rerun. */
export async function runInsights(opts: RunOptions = {}): Promise<RunStats> {
  const log = opts.log ?? (() => {});
  const started = Date.now();
  let all = await loadListings(opts);
  if (opts.perSource) {
    const bySource = new Map<string, ListingForAnalysis[]>();
    for (const l of all.sort(() => Math.random() - 0.5)) {
      const list = bySource.get(l.sourceId) ?? [];
      if (list.length < opts.perSource) list.push(l);
      bySource.set(l.sourceId, list);
    }
    all = [...bySource.values()].flat();
  }
  const todo = all.filter(
    (l) =>
      opts.force ||
      l.existingHash !== inputHash(l) ||
      (opts.retryTextOnly && l.existingPhotoStatus === "text_only"),
  );
  const stats: RunStats = {
    candidates: all.length,
    skipped: all.length - todo.length,
    analyzed: 0,
    textOnly: 0,
    noPhotos: 0,
    failed: [],
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    analysisCostUsd: 0,
    embedded: 0,
    embeddingCostUsd: 0,
    seconds: 0,
  };
  log(`${all.length} listings, ${todo.length} to analyze, ${stats.skipped} unchanged`);
  if (opts.dryRun) {
    stats.seconds = (Date.now() - started) / 1000;
    return stats;
  }

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const l = todo[next++];
      try {
        const r = await withRetry(() => analyzeListing(l));
        await withRetry(() => saveInsight(r));
        stats.analyzed++;
        if (r.photoStatus === "text_only") stats.textOnly++;
        if (r.photoStatus === "no_photos") stats.noPhotos++;
        stats.inputTokens += r.usage.inputTokens;
        stats.cachedTokens += r.usage.cachedTokens;
        stats.outputTokens += r.usage.outputTokens;
        stats.analysisCostUsd += r.usage.costUsd;
      } catch (e) {
        stats.failed.push({ id: l.id, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      }
      done++;
      if (done % 25 === 0 || done === todo.length) {
        const secs = (Date.now() - started) / 1000;
        log(
          `${done}/${todo.length} · ${stats.failed.length} failed · ${stats.textOnly} text-only · $${stats.analysisCostUsd.toFixed(3)} · ${(done / secs).toFixed(1)}/s`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 12) }, worker));

  const scoped = opts.ids || opts.limit || opts.sourceId || opts.perSource;
  const emb = await embedPending({ ids: scoped ? all.map((l) => l.id) : undefined, log });
  stats.embedded = emb.embedded;
  stats.embeddingCostUsd = emb.costUsd;
  stats.seconds = (Date.now() - started) / 1000;
  return stats;
}

/** Analyze and embed specific listings, e.g. the ones an ingest just created or changed. */
export function analyzeListingIds(ids: string[], opts: Omit<RunOptions, "ids"> = {}) {
  if (!ids.length) return Promise.resolve(null);
  return runInsights({ ...opts, ids });
}
