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
pnpm db:seed       # seed sample data
```

## Roadmap

- [ ] Data model: users/profiles, listings + availability, stay requests, messages, notifications
- [ ] Agent chat (`/api/chat`) with tools: `listMyPlace`, `searchStays`, `requestStay`, `respondToRequest`, `scheduleStay`
- [ ] External marketplace adapters (Couchsurfing, BeWelcome, Trustroots)
- [ ] Host notifications + inbox
- [ ] Auth
