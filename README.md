# AgentBnB

A personal agent for finding a place to crash. It searches the couch-surfing
marketplaces for you and has its own internal network of hosts.

## What it does

**Hosting.** Tell the agent "Put my place up for this weekend" and your couch
gets listed on the internal AgentBnB network for those dates.

**Finding a stay.** You land in a city and need somewhere to sleep. The agent
searches every connected marketplace plus the internal network:

- **External marketplaces** (Couchsurfing, BeWelcome, Trustroots, …): the
  agent finds matches and helps you reach out on that platform.
- **Internal network**: the agent notifies the host. The host sees your
  profile and an intro the agent wrote about you, and can reply to you. Once
  they accept, you two schedule the stay.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, `src/`), Tailwind CSS v4
- [AI SDK 7](https://ai-sdk.dev) via Vercel AI Gateway (`ai`, `@ai-sdk/react`)
- Postgres with [Drizzle ORM](https://orm.drizzle.team) on Neon
- Deployed on Vercel (project: `s4m3rs-projects/agentbnb`)

## Getting started

```bash
pnpm install
vercel env pull --yes   # pulls VERCEL_OIDC_TOKEN (AI Gateway), DATABASE_URL, BLOB_READ_WRITE_TOKEN, INGEST_TOKEN
pnpm dev
```

Open http://localhost:3000.

### Database

Neon (`agentbnb-db`) is attached through the Vercel Marketplace; `DATABASE_URL`
is required, including for local dev.

```bash
pnpm db:generate   # generate a migration from src/db/schema.ts
pnpm db:migrate    # apply migrations
pnpm db:seed       # upsert the `sources` table (platforms we pull listings from)
```

Tables (`src/db/schema.ts`): `users`, `sources`, `listings` (internal and
scraped, unique on `source_id + external_id`), `listing_photos`,
`listing_availability`, `external_hosts`, `scrape_runs`, plus
`user_source_accounts` and `applications` for applying on a user's behalf.

## Scraping

Scrapers run **in a browser tab on the source site** (`scripts/scrapers/*.browser.js`),
using the site's own same-origin pages/APIs, and download one JSON file per run.
Load it with:

```bash
pnpm ingest data/scrapes/<source>-<market>-<timestamp>.json
```

Each source has an adapter in `src/lib/sources/` that maps raw records to a
listing. Ingest upserts listings, replaces their photos/availability, records a
`scrape_runs` row, and (for complete runs) marks listings no longer present as
`gone`. Listings are tagged with a `market` from their coordinates
(`src/lib/markets.ts`; currently `sf-bay-area`).

| Source | Kind | Scope | Location |
|---|---|---|---|
| TrustedHousesitters | house sit | open upcoming sits in the Bay Area bounds | city centroid |
| Workaway | work exchange | California host list | host coordinates |
| Worldpackers | work exchange | California positions | host coordinates |

Login-gated couch-surfing sites (Couchsurfing, BeWelcome, Trustroots,
Warmshowers) are in `sources` but are not scraped; they need a user's own
session or a partnership.

### Admin API

Bearer `INGEST_TOKEN`:

- `POST /api/listings` creates a listing on our own network
- `POST /api/listings/:id/photos` uploads photos (multipart `file`) to Vercel Blob
- `POST /api/ingest/:source` pushes scraped records directly (`start` / `batch` / `finish`)

## Roadmap

- [x] Data model: users, sources, listings + photos + availability, scrape runs, applications
- [x] Scrapers: TrustedHousesitters, Workaway, Worldpackers (SF Bay Area)
- [ ] Messages + notifications tables
- [ ] Agent chat (`/api/chat`) with tools: `listMyPlace`, `searchStays`, `requestStay`, `respondToRequest`, `scheduleStay`
- [ ] More sources: Nomador, MindMyHouse, HouseCarers, HelpX; user-session access to Couchsurfing / BeWelcome / Trustroots
- [ ] Host notifications + inbox
- [ ] Auth
