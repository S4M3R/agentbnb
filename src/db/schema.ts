import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** What kind of stays a source offers. */
export const sourceKind = pgEnum("source_kind", [
  "internal",
  "couch",
  "house_sit",
  "work_exchange",
  "farm_stay",
  "home_swap",
]);

/** How we get data out of a source. */
export const sourceAccess = pgEnum("source_access", [
  "internal", // our own network
  "public", // listings visible without login
  "login", // only visible to logged-in members (user-authorized session)
  "partner_api", // official API / partnership
]);

export const listingType = pgEnum("listing_type", [
  "couch",
  "private_room",
  "shared_room",
  "entire_place",
  "house_sit",
  "work_exchange",
  "farm_stay",
]);

export const priceModel = pgEnum("price_model", ["free", "exchange", "paid"]);

export const listingStatus = pgEnum("listing_status", ["active", "paused", "gone"]);

/** How precise listings.lat/lng is. Scraped sources usually only expose a city centroid. */
export const locationPrecision = pgEnum("location_precision", [
  "exact",
  "approximate",
  "neighborhood",
  "city",
]);

export const availabilityKind = pgEnum("availability_kind", ["available", "blocked"]);

export const scrapeRunStatus = pgEnum("scrape_run_status", ["running", "succeeded", "failed"]);

export const accountStatus = pgEnum("account_status", [
  "pending",
  "connected",
  "needs_reauth",
  "disconnected",
]);

export const applicationChannel = pgEnum("application_channel", [
  "internal",
  "external_auto",
  "external_manual",
]);

export const applicationStatus = pgEnum("application_status", [
  "draft",
  "sent",
  "accepted",
  "declined",
  "scheduled",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** Our members: both guests and hosts. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  homeCity: text("home_city"),
  languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
  verified: boolean("verified").notNull().default(false),
  ...timestamps,
});

/** One row per platform we pull listings from. `internal` is our own network. */
export const sources = pgTable("sources", {
  id: text("id").primaryKey(), // slug, e.g. "trustedhousesitters"
  name: text("name").notNull(),
  kind: sourceKind("kind").notNull(),
  access: sourceAccess("access").notNull(),
  baseUrl: text("base_url"),
  tosNotes: text("tos_notes"),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

/** Host identity as seen on an external source (scraped listings only). */
export const externalHosts = pgTable(
  "external_hosts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    profileUrl: text("profile_url"),
    avatarUrl: text("avatar_url"),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    referenceCount: integer("reference_count"),
    rating: real("rating"),
    memberSince: timestamp("member_since", { withTimezone: true }),
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => [uniqueIndex("external_hosts_source_external_idx").on(t.sourceId, t.externalId)],
);

/** Every stay opportunity, internal or scraped. */
export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    hostUserId: uuid("host_user_id").references(() => users.id, { onDelete: "cascade" }),
    externalHostId: uuid("external_host_id").references(() => externalHosts.id, {
      onDelete: "set null",
    }),

    type: listingType("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** What the guest is expected to do in exchange (pet care, work hours, ...). */
    guestExpectations: text("guest_expectations"),
    houseRules: text("house_rules"),

    // Location
    market: text("market"), // coarse bucket we search by, e.g. "sf-bay-area"
    neighborhood: text("neighborhood"),
    city: text("city"),
    subregion: text("subregion"), // county
    region: text("region"), // state / province
    countryCode: text("country_code"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    locationPrecision: locationPrecision("location_precision"),
    address: text("address"), // internal listings only, never scraped

    // Stay details
    maxGuests: integer("max_guests"),
    minNights: integer("min_nights"),
    maxNights: integer("max_nights"),
    priceModel: priceModel("price_model").notNull().default("free"),
    priceAmountCents: integer("price_amount_cents"),
    currency: text("currency"),
    amenities: text("amenities").array().notNull().default(sql`'{}'::text[]`),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    /** Source-specific structured extras (pets, home type, work hours, ...). */
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    rating: real("rating"),

    status: listingStatus("status").notNull().default("active"),

    // Scrape bookkeeping
    raw: jsonb("raw"),
    contentHash: text("content_hash"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("listings_source_external_idx").on(t.sourceId, t.externalId),
    index("listings_market_status_idx").on(t.market, t.status),
    index("listings_city_idx").on(t.city),
    index("listings_lat_lng_idx").on(t.lat, t.lng),
    index("listings_host_user_idx").on(t.hostUserId),
  ],
);

export const listingPhotos = pgTable(
  "listing_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    /** URL to display: our Blob URL when re-hosted, otherwise the source URL. */
    url: text("url").notNull(),
    sourceUrl: text("source_url"),
    blobPathname: text("blob_pathname"),
    position: integer("position").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    caption: text("caption"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("listing_photos_listing_idx").on(t.listingId, t.position)],
);

/** Date ranges a listing is open (or blocked). "This weekend" = one row. */
export const listingAvailability = pgTable(
  "listing_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    kind: availabilityKind("kind").notNull().default("available"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("listing_availability_listing_idx").on(t.listingId),
    index("listing_availability_dates_idx").on(t.startDate, t.endDate),
  ],
);

// ---------------------------------------------------------------------------
// Scraping ops
// ---------------------------------------------------------------------------

export const scrapeRuns = pgTable("scrape_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id),
  market: text("market"),
  status: scrapeRunStatus("status").notNull().default("running"),
  listingsFound: integer("listings_found").notNull().default(0),
  listingsCreated: integer("listings_created").notNull().default(0),
  listingsUpdated: integer("listings_updated").notNull().default(0),
  listingsGone: integer("listings_gone").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Applying on behalf of users (next phase, schema ready now)
// ---------------------------------------------------------------------------

export const userSourceAccounts = pgTable(
  "user_source_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    externalUsername: text("external_username"),
    status: accountStatus("status").notNull().default("pending"),
    /** Pointer to encrypted credentials / session in a secret store. Never plaintext. */
    credentialRef: text("credential_ref"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("user_source_accounts_user_source_idx").on(t.userId, t.sourceId)],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    availabilityId: uuid("availability_id").references(() => listingAvailability.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    /** Intro the agent wrote about the guest for the host. */
    intro: text("intro"),
    channel: applicationChannel("channel").notNull(),
    status: applicationStatus("status").notNull().default("draft"),
    externalRef: text("external_ref"),
    ...timestamps,
  },
  (t) => [
    index("applications_user_idx").on(t.userId),
    index("applications_listing_idx").on(t.listingId),
  ],
);
