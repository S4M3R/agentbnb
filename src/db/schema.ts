import { sql } from "drizzle-orm";
import {
  bigserial,
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

/** `draft`: an internal listing the host hasn't published yet; hidden from search. */
export const listingStatus = pgEnum("listing_status", ["draft", "active", "paused", "gone"]);

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

/** Which personal agent holds an API key. Self-declared at registration; we can't verify it. */
export const agentKind = pgEnum("agent_kind", ["instinct", "dot", "muse", "other"]);

/** Where a host's listing stands on one external network. */
export const publicationStatus = pgEnum("publication_status", [
  "queued",
  "running", // the browser agent is working on it
  "needs_user", // waiting for the host to log in / finish something in the live browser
  "live",
  "failed",
  "removed",
]);

export const applicationStatus = pgEnum("application_status", [
  "draft", // the agent wrote it; waiting for the guest to approve it
  "queued", // approved; waiting for the browser agent (external) or about to go out
  "sending", // the browser agent is submitting it on the external site
  "needs_user", // the guest has to log in / answer something in the live browser
  "sent",
  "accepted",
  "declined",
  "scheduled", // accepted, and guest and host agreed on dates and arrival
  "cancelled", // withdrawn by the guest
  "failed",
]);

/** What happened on an application's timeline. */
export const applicationEventKind = pgEnum("application_event_kind", [
  "status", // status changed; `data` has `from` and `to`
  "message", // guest and host writing to each other
  "activity", // something the agent did or noticed ("Maria viewed your application")
  "nudge", // the agent suggesting a next step ("No reply in 3 days. Follow up?")
]);

export const eventActor = pgEnum("event_actor", ["guest", "host", "agent"]);

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** Our members: both guests and hosts. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").unique(), // null for people who started in the web chat and haven't given one
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  homeCity: text("home_city"),
  languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
  verified: boolean("verified").notNull().default(false),
  ...timestamps,
});

/** A personal agent (Instinct, Dot, Muse, ...) acting on behalf of one of our users. */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: agentKind("kind").notNull(),
    name: text("name").notNull(), // "Instinct", or what an `other` agent calls itself
    ...timestamps,
  },
  (t) => [uniqueIndex("agents_user_kind_name_idx").on(t.userId, t.kind, t.name)],
);

/**
 * Bearer credentials for the public API. `agentId` null means the person themself holds the key.
 * Only the SHA-256 of the key is stored; the key is shown once, when it's created.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(), // first characters of the key, to tell keys apart
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("api_keys_user_idx").on(t.userId)],
);

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

/**
 * A host's internal listing copied onto an external network (Trustroots, BeWelcome, ...) by the
 * browser agent, in a Browserbase session the host can watch and take over.
 */
export const listingPublications = pgTable(
  "listing_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    status: publicationStatus("status").notNull().default("queued"),
    /** Latest thing the agent did or is asking the host to do, shown next to the live view. */
    statusMessage: text("status_message"),
    externalUrl: text("external_url"),
    browserSessionId: text("browser_session_id"),
    liveViewUrl: text("live_view_url"),
    /** Set when the host taps "Continue" after doing something in the live browser. */
    userActedAt: timestamp("user_acted_at", { withTimezone: true }),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("listing_publications_listing_source_idx").on(t.listingId, t.sourceId)],
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
// Applying on behalf of users
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
    /** Latest thing the agent did or needs from the guest, shown on the application card. */
    statusMessage: text("status_message"),
    externalRef: text("external_ref"),
    /** What guest and host agreed for arrival ("Friday around 6pm"), once scheduled. */
    arrival: text("arrival"),

    // Browser agent (external_auto): a Browserbase session the guest can watch and take over.
    browserSessionId: text("browser_session_id"),
    liveViewUrl: text("live_view_url"),
    /** Set when the guest taps "Continue" after doing something in the live browser. */
    userActedAt: timestamp("user_acted_at", { withTimezone: true }),
    /** A browser run holds the application while this is set (stale after a few minutes). */
    runStartedAt: timestamp("run_started_at", { withTimezone: true }),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Last time the host did anything: replied, accepted, declined. Drives follow-up nudges. */
    hostActivityAt: timestamp("host_activity_at", { withTimezone: true }),
    /** When the watcher should next look at the external site for news. */
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("applications_user_idx").on(t.userId),
    index("applications_listing_idx").on(t.listingId),
    index("applications_next_check_idx").on(t.nextCheckAt),
  ],
);

// ---------------------------------------------------------------------------
// Hosting: incoming stay requests and background checks
// ---------------------------------------------------------------------------

export const requestStatus = pgEnum("request_status", [
  "new",
  "replied",
  "accepted",
  "declined",
  "expired",
  "withdrawn", // the guest pulled out
]);

/** What the platform showed about the person asking to stay, captured when the request came in. */
export type GuestSnapshot = {
  name: string;
  profileUrl?: string | null;
  photoUrl?: string | null;
  username?: string | null;
  location?: string | null;
  age?: number | null;
  memberSince?: string | null;
  references?: number | null;
  verified?: boolean | null;
  languages?: string[];
  about?: string | null;
};

/**
 * A request to stay at one of a host's places, from any network. Internal ones mirror an
 * `applications` row; external ones are imported from the host's inbox on that platform.
 */
export const incomingRequests = pgTable(
  "incoming_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostUserId: uuid("host_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    /** Internal requests only. */
    applicationId: uuid("application_id")
      .unique()
      .references(() => applications.id, { onDelete: "cascade" }),
    /** Set when the guest is one of our members. */
    guestUserId: uuid("guest_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The request's id on the platform. */
    externalRef: text("external_ref"),
    /** Where the host answers it on the platform. */
    externalUrl: text("external_url"),
    guest: jsonb("guest").$type<GuestSnapshot>().notNull(),
    message: text("message"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    guestCount: integer("guest_count"),
    status: requestStatus("status").notNull().default("new"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("incoming_requests_host_idx").on(t.hostUserId, t.receivedAt),
    uniqueIndex("incoming_requests_host_source_ref_idx").on(t.hostUserId, t.sourceId, t.externalRef),
  ],
);

export const backgroundCheckStatus = pgEnum("background_check_status", ["running", "done", "failed"]);

export const backgroundCheckVerdict = pgEnum("background_check_verdict", [
  "consistent", // everything we found lines up
  "some_gaps", // nothing wrong, but not much to go on
  "red_flags",
]);

export const findingCategory = pgEnum("finding_category", [
  "identity", // does the name, photo, age and location line up across sources
  "reputation", // references, reviews, past stays
  "presence", // where else they show up online, and what it says
  "red_flag",
]);

export const findingConfidence = pgEnum("finding_confidence", ["low", "medium", "high"]);

/** The profile of the guest the agent builds up while it investigates. */
export type CheckProfile = {
  name?: string;
  /** One line on who they seem to be ("Product designer from Berlin, travels by bike"). */
  headline?: string;
  location?: string;
  occupation?: string;
  languages?: string[];
  /** How sure we are that the profiles below are all the same person. */
  identity?: "strong" | "partial" | "weak" | "unknown";
  profiles?: { platform: string; url: string; note?: string }[];
};

/**
 * A host-requested look at a guest's public footprint. Identity and consistency only: no criminal
 * records, no credit. Internal guests can read checks about themselves. Deleted at `expiresAt`.
 */
export const backgroundChecks = pgTable(
  "background_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => incomingRequests.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The guest, when they're one of our members; they can see this check. */
    guestUserId: uuid("guest_user_id").references(() => users.id, { onDelete: "set null" }),
    status: backgroundCheckStatus("status").notNull().default("running"),
    verdict: backgroundCheckVerdict("verdict"),
    summary: text("summary"),
    profile: jsonb("profile").$type<CheckProfile>().notNull().default({}),
    /** Things worth asking the guest before saying yes. */
    questions: text("questions").array().notNull().default(sql`'{}'::text[]`),
    /** What the agent looked for and couldn't confirm. */
    unverified: text("unverified").array().notNull().default(sql`'{}'::text[]`),
    model: text("model"),
    steps: integer("steps").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    index("background_checks_request_idx").on(t.requestId, t.startedAt),
    index("background_checks_guest_idx").on(t.guestUserId),
    index("background_checks_expires_idx").on(t.expiresAt),
  ],
);

/** One sourced fact in a check's report. */
export const backgroundCheckFindings = pgTable(
  "background_check_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => backgroundChecks.id, { onDelete: "cascade" }),
    category: findingCategory("category").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    sourceUrl: text("source_url"),
    sourceTitle: text("source_title"),
    confidence: findingConfidence("confidence").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("background_check_findings_check_idx").on(t.checkId, t.createdAt)],
);

/** The live feed of what the agent is doing ("Searching the web for ..."), shown while it runs. */
export const backgroundCheckEvents = pgTable(
  "background_check_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(), // ordered, so pollers can ask for "after <id>"
    checkId: uuid("check_id")
      .notNull()
      .references(() => backgroundChecks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // search | read | profile | finding | note | error
    message: text("message").notNull(),
    url: text("url"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("background_check_events_check_idx").on(t.checkId, t.createdAt)],
);

/** Timeline of one application: status changes, messages, and what the agent did or noticed. */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: applicationEventKind("kind").notNull(),
    actor: eventActor("actor").notNull(),
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("application_events_application_idx").on(t.applicationId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** In-app inbox. Each row is also pushed and emailed when the person has those set up. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    /** Path to open, e.g. `/applications/<id>`. */
    url: text("url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

/** A browser's Web Push subscription. Deleted when the push service says it's gone. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Agent-to-agent (A2A)
// ---------------------------------------------------------------------------

/**
 * A short link (/s/<id>) to listings an agent picked, for another agent (Instinct, ...) to send
 * its person in iMessage, where it unfurls with a generated preview image. One listing renders
 * as a listing page, several as a list. Drafts only show when they belong to `userId`.
 */
export const shareLinks = pgTable(
  "share_links",
  {
    id: text("id").primaryKey(), // short, URL-safe; the path segment
    title: text("title").notNull(),
    note: text("note"),
    listingIds: uuid("listing_ids").array().notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    /** The person the link was made for, when the caller was authenticated. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** The agent that asked for it, shown as "Sent by Instinct". */
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("share_links_user_idx").on(t.userId)],
);

/**
 * One A2A turn: the caller's message and our reply. Turns sharing a `contextId` are one
 * conversation; `modelMessages` replays it to the model. Anonymous callers have no `userId`.
 */
export const a2aTasks = pgTable(
  "a2a_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: text("context_id").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    state: text("state").notNull(), // completed | failed (we answer synchronously)
    /** The A2A messages, caller's then ours, in 1.0 JSON shape. */
    history: jsonb("history").$type<Record<string, unknown>[]>().notNull(),
    artifacts: jsonb("artifacts").$type<Record<string, unknown>[]>().notNull().default([]),
    modelMessages: jsonb("model_messages").$type<unknown[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("a2a_tasks_context_idx").on(t.contextId, t.createdAt)],
);
