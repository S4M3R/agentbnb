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
- Postgres with [Drizzle ORM](https://orm.drizzle.team): Neon in production,
  PGlite (embedded Postgres) for local dev
- Deployed on Vercel (project: `s4m3rs-projects/agentbnb`)

## Getting started

```bash
pnpm install
vercel env pull --yes   # pulls VERCEL_OIDC_TOKEN for AI Gateway (and DATABASE_URL once Neon is attached)
pnpm dev
```

Open http://localhost:3000.

### Database

Neon is provisioned through the Vercel Marketplace. Accept Neon's terms once at
https://vercel.com/s4m3rs-projects/~/integrations/accept-terms/neon, then run:

```bash
vercel integration add neon --no-claim --name agentbnb-db
vercel env pull --yes
```

When `DATABASE_URL` isn't set, the app uses a local PGlite database instead.

## Roadmap

- [ ] Data model: users/profiles, listings + availability, stay requests, messages, notifications
- [ ] Agent chat (`/api/chat`) with tools: `listMyPlace`, `searchStays`, `requestStay`, `respondToRequest`, `scheduleStay`
- [ ] External marketplace adapters (Couchsurfing, BeWelcome, Trustroots)
- [ ] Host notifications + inbox
- [ ] Auth
