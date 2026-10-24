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

## Domain model (planned)
- **User / Profile**: who you are, bio, languages, references. Used as both guest
  and host.
- **Listing**: a host's place (city, capacity, description, house rules).
- **Availability**: date ranges when a listing is open ("this weekend").
- **StayRequest**: guest → listing for dates, agent-written intro, status
  (`pending` → `accepted` / `declined` → `scheduled`).
- **Message**: guest ↔ host conversation tied to a request.
- **Notification**: e.g. "new stay request" sent to a host.

## Agent tools (planned, AI SDK `tool()`s on `/api/chat`)
- `listMyPlace`: publish/update the user's listing for given dates
- `searchStays`: search the internal network plus the external adapters for a city/dates
- `requestStay`: send a request to an internal host (writes the guest intro, notifies the host)
- `respondToRequest`: host accepts/declines and replies
- `scheduleStay`: confirm dates/arrival time
- `getNotifications` / `getMyRequests`: inbox for both sides

## Stack & conventions
- Next.js 16 App Router under `src/`, Tailwind v4, pnpm. **Read
  `node_modules/next/dist/docs/` before writing Next.js code** (see AGENTS.md).
- AI SDK 7 (`ai`, `@ai-sdk/react`) through Vercel AI Gateway using plain
  `"provider/model"` strings. Check `node_modules/ai/docs/` for v7 APIs (e.g.
  `isStepCount`, `toUIMessageStream`), not remembered v5/v6 patterns.
- Postgres via Drizzle ORM on Neon (`DATABASE_URL`, required everywhere,
  including local dev). Migrations: `pnpm db:generate` / `pnpm db:migrate`.
- Vercel project: `s4m3rs-projects/agentbnb`. Pull env with `vercel env pull --yes`.
- Neon (`agentbnb-db`) and Vercel Blob are attached via the Vercel Marketplace.
