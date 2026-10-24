@AGENTS.md

# AgentBnB — project context

## The idea

AgentBnB is a **personal agent for finding a place to crash** (a couch, a spare
room). You talk to it in natural language and it handles the whole flow for you.

It has two sides:

1. **Aggregator of external couch-surfing marketplaces.** The agent searches all
   of them for you (Couchsurfing, BeWelcome, Trustroots, …), so you don't have
   to search each one yourself.
2. **An internal marketplace / network of its own.** AgentBnB users can list
   their own place, and other users can find and book it through the agent.

## Core flows

### Hosting: "Put my place up for this weekend"
- The host tells the agent in one sentence, e.g. "Put my place up for this
  weekend."
- The agent creates (or reuses) the host's listing and publishes it to the
  internal network for those dates. No forms; the agent works out the dates
  and details from the conversation and the host's profile.

### Finding a stay: "I just got to the city, I need a couch"
- The guest arrives in a city and asks the agent for a place to stay.
- The agent searches **the external marketplaces and the internal network at
  the same time** and returns the combined results.
- **When the match is on the internal network:**
  1. The agent **notifies the host** of that couch.
  2. The host receives the request and **sees the guest's profile**, plus an
     intro the agent writes about the guest (who they are, why they're
     coming, dates).
  3. The host can **message the guest** directly.
  4. Guest and host then **schedule the stay** (dates, arrival time).
- **When the match is on an external marketplace:** the agent surfaces it and
  helps the guest reach out on that platform (deep links / drafted message).
  Those platforms have no public APIs.

## Domain model (`src/db/schema.ts`)
- **users**: our members, both guests and hosts. `email` is null for people who started in
  the web chat: it has no sign-in yet, so each browser holds a person key in an httpOnly
  cookie (`src/lib/session.ts`) and the user row is created the first time they host.
  Each member has a public profile at `/people/[id]` (never email, addresses or exact
  locations), edited at `/me/profile`, by the chat agent, or with `PATCH /api/v1/me`.
- **agents**: a personal agent acting for a user; `kind` is `instinct` / `dot` / `muse` /
  `other` (self-declared, unverified), plus a `name`.
- **api_keys**: bearer keys for `/api/v1`, held by the person (`agent_id` null) or one of
  their agents. Only the SHA-256 is stored. See `src/lib/api-auth.ts`.
- **sources**: platforms we pull from (`internal` = our own network), with `kind`
  (couch / house_sit / work_exchange / ...) and `access` (public / login / partner_api).
- **listings**: one table for internal and scraped stays; unique on
  `(source_id, external_id)`; `market` bucket (e.g. `sf-bay-area`) from lat/lng;
  `location_precision` says how exact the coordinates are; source-specific
  extras go in `attributes` (jsonb), the scraped record in `raw`. Internal listings start
  as `draft` (hidden from search) until the host publishes; `address` is private, and
  lat/lng are rounded to ~1 km.
- **listing_photos**, **listing_availability** (date ranges), **external_hosts**.
- **scrape_runs**: one row per ingest; complete runs mark unseen listings `gone`.
- **listing_publications**: a host's internal listing copied onto an external network
  (Trustroots, BeWelcome, ...), with status `queued` / `running` / `needs_user` / `live` /
  `failed` / `removed`, the live-view URL while a browser session is open, and the public URL.
- **user_source_accounts**: a user's account on an external network; `credential_ref` is their
  Browserbase context id (saved cookies, so they log in once). `status: connected` means the
  browser agent saw them logged in; the Keychain lists those as "Signed in (browser session)".
- **keychain_entries**: the person's logins on other sites (`/me/keychain`), one per user + `site`
  (a source id like `workaway`, or a bare domain for any other website). `login` is plain;
  the password is only stored as `secret_ciphertext`. `created_by`: `person` | `agent`;
  `status`: `active` | `unverified` (the agent created it and hasn't signed in with it yet) |
  `failed` (the site rejected it). Same account as a `user_source_accounts` row with the same
  (user_id, source_id). **keychain_settings**: per user, `allow_sign_up` ("let my agent create
  accounts for me", on by default; no row = defaults).
- **applications**: a guest applying to a listing (any source). `channel`: `internal` (goes to
  the host's inbox), `external_auto` (the browser agent applies on the site), `external_manual`
  (the guest did it themself). Status: `draft` → `queued` → `sending` / `needs_user` → `sent` →
  `accepted` / `declined` → `scheduled`; or `cancelled` (withdrawn) / `failed`.
- **application_events**: each application's timeline: `status` changes, `message`s between
  guest and host (guest replies on external sites carry `data.delivery: "pending"` until the
  browser agent sends them), agent `activity`, and `nudge`s (overlap, no reply in 3 days).
- **notifications**: in-app inbox (the Applications tab badge); each row is also sent by
  Web Push (**push_subscriptions**, VAPID keys in env) and email (Resend) when available.
- **incoming_requests**: stay requests a host received, from any network. Internal ones are
  mirrored from `applications` when the host opens `/requests`; answering one there goes
  through `setStatus`, so the guest hears about it; external ones are imported
  (`POST /api/v1/requests`), unique per host on `(source_id, external_ref)`.
- **background_checks** (+ `_findings`, `_events`): a host-requested look at a guest's public
  footprint, run by the agent in `src/lib/checks/agent.ts`. Identity and consistency only:
  never criminal, court or credit records, nothing behind a login. Member guests can read
  checks about themselves (`/me/checks`). Deleted at `expires_at` (30 days after the host
  answers or the stay ends, 90 if never answered).
- **share_links**: short links (`/s/<id>`) to listings an agent picked, for another agent to send in
  iMessage. Public, so they show public fields only; a host's draft only on a link made for that host.
- **a2a_tasks**: one A2A turn (caller's message + our reply, stored in 1.0 shape); turns sharing a
  `context_id` are one conversation, replayed to the model from `model_messages`.

## Scraping conventions
- Scrapers are browser scripts (`scripts/scrapers/<source>.browser.js`) run in a
  tab on the source site; they download a JSON file that `pnpm ingest <file>`
  loads. Mapping lives server-side in `src/lib/sources/<source>.ts` (register it
  in `src/lib/sources/index.ts`).
- Browser tabs can't reliably reach `localhost` (Chrome Local Network Access),
  so prefer the download-file flow over posting to the local ingest API.
- Only scrape public listing pages. Login-gated sites (Couchsurfing, BeWelcome,
  Trustroots, Warmshowers) only via a user's own session or a partnership.
- Don't store other people's data we don't need (e.g. sitter profiles attached
  to past TrustedHousesitters assignments are stripped from `raw`). Never
  scrape exact addresses.
- Paginated APIs need a stable sort (TrustedHousesitters: `published desc`),
  otherwise pages overlap and listings get missed.

## Hosting: adding your place (`src/lib/hosting/`)
- A casual back-and-forth, one question per turn. The agent asks where the place is with
  `askForLocation` (share current location, or search / drop a pin on a map) and for photos
  with `askForPhotos` (a shot list with a tip per shot and a full-screen camera that walks
  through it; library upload and the OS camera as fallbacks). Both are client-side tools: no
  `execute`, the browser answers with `addToolOutput` and the chat re-sends automatically.
  `askForPhotos` returns the images to the model via `toModelOutput`.
- It writes the listing itself and shows a preview card. Publishing to AgentBnB waits for the
  host's OK unless they said to publish right away.
- Photos go straight from the browser to Vercel Blob (`/api/hosting/photos`, client upload,
  shrunk to 1600px). The chat route appends the photo URLs as text so the model can pass them on.
- `networks.ts` lists the external networks with which arrangement each fits (`hosting`,
  `house_sit`, `exchange`), how easy each is to automate, and site hints for the browser agent.
- `browser-agent.ts`: one Browserbase session per attempt (Stagehand driven by an AI SDK tool
  loop), run in `after()` on `/api/hosting/publications` (maxDuration 300). The chat card embeds
  the live view; the host can take control at any time. Logins go through the Keychain access
  tools (below); CAPTCHAs, 2FA and payment go through `askHost`. Out of time → the host taps Continue
  and a new session resumes on the same saved context.
- Stagehand must stay in `serverExternalPackages` (it uploads its extension zip from its package).
- Hosting section: the header's Hosting tab is `/hosting` (Listings) with a sub-nav to `/requests`
  (`HostingTabs`; `isActive` counts both). `/hosting` shows each listing with "Where it's listed"
  (AgentBnB + every fitting network, `networksForListing`): publish/pause on AgentBnB (server
  action), retry, watch, and "List on more sites". "Edit in chat" opens `/?prompt=…`.
- Publish picker (`NetworkPicker` in `src/app/hosting.tsx`, view in `src/components/hosting/`):
  tick networks, "Publish to N sites" sends one `POST /api/hosting/publications { listingId,
  networks }`. The server starts up to `MAX_PARALLEL_RUNS` (3) browser runs per host and queues
  the rest; the picker starts queued ones as runs finish. Same picker in the chat
  (`recommendNetworks`, `addToNetworks`) and in the listings page's sheet.
- Next: keep publications in sync when the listing changes, and pull requests from external
  networks into the agent's inbox.

## Keychain and logging in on other sites (`src/lib/keychain.ts`, `src/lib/browser-access.ts`)
- Browser agents try the task as-is first (listing page, apply button) and only deal with
  accounts when the site gates the next step. Then, in order (`decideAccess` in `src/lib/access.ts`):
  already signed in → continue; a Keychain login → `logIn` without asking; none → `signUp` (free
  account, if the person allows it and has an email) or `askForLogin` (a `needs_user` request with
  a secure form, or they log in themselves in the live browser); CAPTCHA / 2FA / email link /
  paid membership → `askUser` / `askHost`. Never pay or start a membership. Unattended runs
  (cron checks) can only `logIn`; otherwise they give up with "You're logged out".
- A `needs_user` status event carries `data.ask` (`{ kind: "credentials" | "email" | "browser",
  site, siteName }`); `latestAsk()` reads it, and `NeedsUserBlock` (`src/app/me/keychain/forms.tsx`)
  shows the login or email form, else the live browser / Continue, on `/applications/[id]`, the
  chat's application panel and `/me/keychain`.
- Security rules:
  - Passwords are encrypted at rest with AES-256-GCM (random 12-byte IV per entry, user id + site
    as additional data) under `KEYCHAIN_KEY` (32 bytes, base64; in `.env.local` and Vercel for
    every environment). Only `src/lib/keychain.ts` encrypts or decrypts.
  - The model never sees a secret. `logIn` / `signUp` pass passwords to Stagehand only as `act()`
    variables (its model sees `%password%`; the value is filled in inside the browser) with
    `cache: false` (Stagehand's action cache key would include variable values), and return only
    "signed_in" / "filled" / "failed" plus a scrubbed site message. Never put a secret in prompts,
    tool results, notes, events, logs, `variables` of the general `act` tool, or Browserbase metadata.
  - Passwords are write-only in the UI; "Reveal" works only for `created_by: agent` entries and
    needs an explicit click. Server actions never log their arguments or error objects.
  - The chat never asks for passwords; it points people to the Keychain. No public API for secrets.

## Applying for stays (`src/lib/applications.ts`, `src/lib/apply-agent.ts`)
- The agent drafts one application per listing (intro in the guest's voice, tailored with
  `getListing`); the guest approves with Send / Send all on the chat cards (or says so in chat).
  Nothing is sent without that approval. Applying to several places at once is encouraged.
- In the chat, a drafted or opened application shows in the side panel like a listing
  (`src/app/application-panel.tsx`, data from `GET /api/applications/<id>`): intro, Send, activity and replies.
- Every status change goes through `setStatus`, which logs the event and notifies the right
  side. `/applications` shows tabs (In progress / Confirmed / Closed); pages poll with
  `router.refresh()`. Hosts get requests in `/requests` (main's inbox, mirrored from internal
  applications); the conversation and arrival for a member's request live on `/applications/<id>`.
- External applications: one generic browser agent for every site (`src/lib/browser-agent.ts`,
  no per-site scripts). A run submits, delivers pending replies, and checks for host news.
  Runs start only from `POST /api/applications/run` (the client calls it after Send / Continue /
  reply, and when it shows an application; the cron fans out to it). It's idempotent: a run
  holds `run_started_at`. Only that route may import `apply-agent.ts` (Stagehand tracing).
- `/api/cron/applications` (`vercel.ts`; daily on Hobby) starts due checks and sends the
  "no reply in 3 days" nudges. Opening the app also re-checks (at most every 30 min).

## Calendar (`/calendar`, `src/components/calendar/`, `src/lib/calendar.ts`)
- One month view of both sides: a lane per place you host (guests booked, requests, open and
  blocked nights, from AgentBnB and every network) and a "Where you sleep" lane for your trips
  (confirmed stays, applications still waiting, gaps of up to 7 nights between stays, and nights
  booked twice). A stay covers its nights, `start` up to (not including) `end`; availability ranges
  are inclusive. All the shaping is pure (`calendar.ts`), shared by the page, the chat card
  (`getMyCalendar`) and the dev screen (`/dev/screens/calendar`).

## Agent tools (AI SDK `tool()`s on `/api/chat`)
- Search: `searchStays`, `getListing`, `getCoverage`, and `askForDates` (client-side calendar, `src/app/date-request.tsx`;
  limited to a listing's open windows and minimum stay when passed; web chat only, not A2A).
- Hosting: `askForLocation`, `askForPhotos` (client-side), `saveListingDraft`, `publishListing`,
  `recommendNetworks`, `addToNetworks`, `getMyListings`.
- Applying: `getMyApplications`, `applyToListings`, `sendApplications`,
  `messageHost`, `withdrawApplications`, `scheduleStay`, `respondToRequest` (hosts).
- Profile: `getMyProfile`, `updateProfile` (name, photo, bio, home city, languages, plus the private
  email in the web chat), filled from the conversation. `src/lib/agent/profile-tools.ts`; validation is
  `ProfileInput` in `src/lib/profile.ts`, shared with `/me/profile` and `PATCH /api/v1/me`.
- Calendar: `getMyCalendar` (a month card in the chat; the model gets only the summary).

## A2A (agent-to-agent): Instinct and other personal agents (`src/lib/a2a/`)
- Agent card at `/.well-known/agent-card.json` (also `/.well-known/agent.json`), JSON-RPC at `/a2a`. Speaks
  A2A 1.0 and 0.3 (`protocol.ts` converts; the version comes from the `A2A-Version` header, else the method
  name). Answers synchronously with a completed task; no streaming or push.
- Same API keys as `/api/v1`, optional: anonymous callers can search, hosting needs a key. A bad key is a
  401, never a silent downgrade.
- `agent.ts` runs the same stay tools as the web chat plus `shareLink`, and for keyed callers
  `saveListingDraft` / `publishListing` / `getMyListings`, and `getMyProfile` / `updateProfile` without
  email (the client-side location/photo tools don't apply; location comes as text, photos as image parts that `photos.ts` copies into Blob). Replies are plain text for
  iMessage, ending with the share link; if the model forgets, the top search results get a link anyway.
- Share pages `/s/[id]` are phone-first; `opengraph-image.tsx` draws the preview (photo mosaic + headline,
  Inter from `assets/fonts/`). Satori only draws JPEG/PNG/GIF, so photos are fetched and filtered first.
  iMessage's link fetcher identifies as `facebookexternalhit`, so Next puts metadata in `<head>` for it.

## Design
- UI follows `DESIGN.md` (Airbnb-inspired tokens and components, from
  VoltAgent/awesome-design-md, MIT). Read it before building or restyling UI.
  Airbnb Cereal is proprietary: use Inter, as the file's font note suggests.
- Brand: the agent is **Couchbot** (`Couchbot` in `src/components/brand/logo.tsx`), a puffy
  armchair that is both the logo and the agent's face. Moods: `idle`, `thinking` (while it works),
  `happy`, `sleepy` (empty states, 404); `animated` adds blink / look-around / bob. The wordmark and
  Couchbot's big lines (home greeting, 404) use Bricolage Grotesque (`font-brand`); the rest is Inter.
- SEO lives in `src/app/layout.tsx` (metadata, JSON-LD), `src/lib/site.ts` (URL, name, copy),
  `robots.ts`, `sitemap.ts`, `manifest.ts` and `opengraph-image.tsx`. Pages set a bare `title`;
  the layout's template adds " · AgentBnB".

## Stack & conventions
- Next.js 16 App Router under `src/`, Tailwind v4, pnpm. **Read
  `node_modules/next/dist/docs/` before writing Next.js code** (see AGENTS.md).
- AI SDK 7 (`ai`, `@ai-sdk/react`) through Vercel AI Gateway using plain
  `"provider/model"` strings. Check `node_modules/ai/docs/` for v7 APIs (e.g.
  `isStepCount`, `toUIMessageStream`), not remembered v5/v6 patterns.
- Postgres via Drizzle ORM on Neon (`DATABASE_URL`, required everywhere,
  including local dev). Migrations: `pnpm db:generate` / `pnpm db:migrate`.
- Vercel project: `s4m3rs-projects/agentbnb`. Pull env with `vercel env pull --yes`.
- Neon (`agentbnb-db`), Vercel Blob (`agentbnb-photos`) and Browserbase
  (`BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`) are attached via the Vercel Marketplace /
  `vercel blob`. Admin endpoints use bearer `INGEST_TOKEN`.
- Public API for people and their agents lives under `/api/v1` (register, me, keys, requests,
  background-checks) and A2A at `/a2a`, with
  agent-readable docs at `/docs.md`, and a step-by-step setup guide at `/setup/<agent id>` (generic: `/setup`; one
  page for people and agents, Markdown via `Accept: text/markdown` or `/setup.md?agent=<id>`; content in
  `src/lib/setup-guide.ts`, agents in `src/lib/connect-agent.ts`) that the home banner's one-line prompts
  point to. Its link previews are GIFs from `pnpm exec tsx tools/setup-previews.tsx`. Errors are `{ error: { code, message } }`; keep
  `/docs.md` in sync when endpoints change.
