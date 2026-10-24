import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addEvent, recordHostMessage, setStatus } from "@/lib/applications";
import { BrowserAgentError, markConnected, runBrowserTask, type AskResult } from "@/lib/browser-agent";

// The browser agent applying on external sites for the guest. One run does whatever an
// application needs right now:
//   - submit it (status queued), handing the browser to the guest to log in if needed;
//   - send replies the guest wrote in AgentBnB (message events with delivery "pending");
//   - check the site for news: host messages, accepted / declined.
// Runs start from POST /api/applications/run (a person's click, or the cron fanning out), never
// from the chat route, because Stagehand only ships with the routes that trace it.

const { applications, applicationEvents: events, listings, sources, users } = schema;

const RUN_BUDGET_MS = 270_000;
const POLL_MS = 2500;
/** A run that hasn't released its lock after this long crashed; take over. */
const STALE_RUN_MS = 6 * 60_000;
/** Opening the app re-checks external sites at most this often. */
const RECHECK_ON_VISIT_MS = 30 * 60_000;
/** Unattended checks (cron). */
const NEXT_CHECK_MS = 6 * 60 * 60_000;

const WATCHED = ["sent", "accepted", "scheduled"] as const;

type Mode = { interactive: boolean; force?: boolean };

const Finish = z.object({
  submitted: z.boolean().describe("True if the application is now submitted on the site (by you in this run, or earlier)."),
  applicationStatus: z
    .enum(["pending", "accepted", "declined", "unknown"])
    .describe("What the site says about the application right now."),
  hostMessages: z
    .array(z.object({ text: z.string(), sentAt: z.string().optional() }))
    .describe("Every message from the host in the conversation, oldest first, verbatim. Repeat old ones too; we skip duplicates."),
  deliveredMessageIds: z.array(z.string()).describe("Ids of the guest's pending messages you sent in this run."),
  externalRef: z.string().optional().describe("URL of the application or the conversation with the host."),
  summary: z.string().describe('One sentence for the guest, e.g. "Applied on Workaway; Maria usually replies within 2 days."'),
});

type Finished = z.infer<typeof Finish>;

async function load(id: string) {
  const [row] = await db
    .select({
      app: applications,
      listing: { title: listings.title, url: listings.externalUrl, sourceId: listings.sourceId, description: listings.description },
      sourceName: sources.name,
      sourceUrl: sources.baseUrl,
      guest: { name: users.name, bio: users.bio, homeCity: users.homeCity, languages: users.languages },
    })
    .from(applications)
    .innerJoin(listings, eq(listings.id, applications.listingId))
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(eq(applications.id, id));
  return row;
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

/** Atomically take the application for a run. Null if another run holds it. */
async function claim(id: string) {
  const [row] = await db
    .update(applications)
    .set({ runStartedAt: new Date(), attempts: sql`${applications.attempts} + 1` })
    .where(
      and(
        eq(applications.id, id),
        eq(applications.channel, "external_auto"),
        or(isNull(applications.runStartedAt), lt(applications.runStartedAt, new Date(Date.now() - STALE_RUN_MS))),
      ),
    )
    .returning({ id: applications.id });
  return !!row;
}

async function release(id: string) {
  await db
    .update(applications)
    .set({ runStartedAt: null, browserSessionId: null, liveViewUrl: null })
    .where(eq(applications.id, id));
}

async function pendingMessages(id: string) {
  return db
    .select({ id: events.id, body: events.body })
    .from(events)
    .where(and(eq(events.applicationId, id), eq(events.kind, "message"), sql`${events.data}->>'delivery' = 'pending'`))
    .orderBy(asc(events.createdAt));
}

async function knownHostMessages(id: string) {
  const rows = await db
    .select({ data: events.data })
    .from(events)
    .where(and(eq(events.applicationId, id), eq(events.kind, "message"), eq(events.actor, "host")));
  return new Set(rows.map((r) => r.data.hash as string | undefined).filter(Boolean));
}

function hash(text: string) {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 16);
}

/** Do whatever this application needs on the external site. Never throws. */
export async function runApplication(id: string, mode: Mode) {
  if (!(await claim(id))) return;
  let row: Loaded | undefined;
  try {
    row = await load(id);
    if (!row) return;
    const { app } = row;
    const submit = app.status === "queued" || app.status === "sending" || app.status === "needs_user";
    const watching = (WATCHED as readonly string[]).includes(app.status);
    const outbox = watching ? await pendingMessages(id) : [];
    const due =
      mode.force ||
      !app.lastCheckedAt ||
      app.lastCheckedAt.getTime() < Date.now() - (mode.interactive ? RECHECK_ON_VISIT_MS : NEXT_CHECK_MS) + 60_000;
    if (!submit && !(watching && (outbox.length || due))) return;
    if (!row.listing.url) {
      if (submit) await setStatus(id, "failed", { actor: "agent", message: "This listing has no link to apply on." });
      return;
    }

    if (submit) {
      await db
        .update(applications)
        .set({ status: "sending", statusMessage: `Opening ${row.sourceName}…`, error: null })
        .where(eq(applications.id, id));
    }
    await run(row, { submit, outbox, interactive: mode.interactive && submit });
  } catch (err) {
    const message =
      err instanceof BrowserAgentError ? err.message : "The browser broke while I was working. Tap Try again.";
    if (!(err instanceof BrowserAgentError)) console.error("application run failed", id, err);
    if (row && ["queued", "sending", "needs_user"].includes((await load(id))?.app.status ?? "")) {
      await setStatus(id, "failed", { actor: "agent", message, patch: { error: message } });
    }
  } finally {
    await release(id);
  }
}

async function run(
  row: Loaded,
  { submit, outbox, interactive }: { submit: boolean; outbox: { id: string; body: string | null }[]; interactive: boolean },
) {
  const { app } = row;
  const id = app.id;
  const site = row.sourceName;

  async function askUser(message: string, deadline: number): Promise<AskResult> {
    const asked = new Date();
    await setStatus(id, "needs_user", { actor: "agent", message });
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const [a] = await db
        .select({ status: applications.status, userActedAt: applications.userActedAt })
        .from(applications)
        .where(eq(applications.id, id));
      if (!a || a.status === "cancelled" || a.status === "failed") return "stopped";
      if (a.status === "sent") return "user_finished"; // they tapped "I applied myself"
      if (a.userActedAt && a.userActedAt >= asked) return "continue";
    }
    return "timeout";
  }

  const outcome = await runBrowserTask({
    userId: app.userId,
    sourceId: row.listing.sourceId,
    startUrl: app.externalRef ?? row.listing.url!,
    instructions: instructions(row, { submit, outbox, interactive }),
    prompt: submit
      ? `The browser is open at the listing. Apply to it.`
      : `The browser is open at ${app.externalRef ? "the conversation" : "the listing"}. ${outbox.length ? "Send the pending messages, then check" : "Check"} for news.`,
    variables: { intro: app.intro ?? "", ...Object.fromEntries(outbox.map((m, i) => [`message${i + 1}`, m.body ?? ""])) },
    finish: { description: "Call when you're done: report what the site shows.", inputSchema: Finish },
    budgetMs: interactive ? RUN_BUDGET_MS : 120_000,
    metadata: { applicationId: id },
    onLive: async (sessionId, liveViewUrl) => {
      await db.update(applications).set({ browserSessionId: sessionId, liveViewUrl }).where(eq(applications.id, id));
    },
    onNote: async (note) => {
      if (!submit) {
        const [a] = await db.select({ status: applications.status }).from(applications).where(eq(applications.id, id));
        return a?.status !== "cancelled";
      }
      const [a] = await db
        .update(applications)
        .set({ statusMessage: note })
        .where(and(eq(applications.id, id), eq(applications.status, "sending")))
        .returning({ id: applications.id });
      return !!a;
    },
    askUser: interactive ? askUser : undefined,
    onClose: async () => {},
  });

  const now = new Date();
  switch (outcome.kind) {
    case "finished":
      await record(row, outcome.result, { submit, outbox });
      break;
    case "gave_up":
      if (submit) await setStatus(id, "failed", { actor: "agent", message: outcome.reason, patch: { error: outcome.reason } });
      else {
        await addEvent(id, "activity", "agent", `Couldn't check ${site}: ${outcome.reason}`);
        await db.update(applications).set({ lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + NEXT_CHECK_MS) }).where(eq(applications.id, id));
      }
      break;
    case "out_of_time":
      if (submit)
        await setStatus(id, "needs_user", {
          actor: "agent",
          message: "I ran out of time in this browser. Tap Continue and I'll pick up where I left off.",
        });
      break;
    case "stopped":
    case "user_finished":
      break; // the guest's own action already set the status
  }
}

async function record(row: Loaded, r: Finished, { submit, outbox }: { submit: boolean; outbox: { id: string }[] }) {
  const { app } = row;
  const id = app.id;
  const now = new Date();
  const patch = {
    lastCheckedAt: now,
    nextCheckAt: new Date(now.getTime() + NEXT_CHECK_MS),
    ...(r.externalRef && { externalRef: r.externalRef }),
  };

  if (submit) {
    if (!r.submitted) {
      await setStatus(id, "failed", { actor: "agent", message: r.summary, patch: { ...patch, error: r.summary } });
      return;
    }
    await setStatus(id, "sent", { actor: "agent", message: r.summary, patch });
    await markConnected(app.userId, row.listing.sourceId);
  } else {
    await db.update(applications).set(patch).where(eq(applications.id, id));
  }

  const delivered = new Set(r.deliveredMessageIds);
  for (const m of outbox) {
    if (!delivered.has(m.id)) continue;
    await db
      .update(events)
      .set({ data: sql`${events.data} || '{"delivery":"sent"}'::jsonb` })
      .where(eq(events.id, m.id));
  }

  const known = await knownHostMessages(id);
  for (const m of r.hostMessages) {
    const h = hash(m.text);
    if (known.has(h)) continue;
    known.add(h);
    await recordHostMessage(id, m.text, { hash: h, sentAt: m.sentAt });
  }

  const [current] = await db.select({ status: applications.status }).from(applications).where(eq(applications.id, id));
  if (current?.status === "sent" && (r.applicationStatus === "accepted" || r.applicationStatus === "declined")) {
    await setStatus(id, r.applicationStatus, { actor: "host", message: r.summary });
  }
}

function instructions(
  row: Loaded,
  { submit, outbox, interactive }: { submit: boolean; outbox: { id: string; body: string | null }[]; interactive: boolean },
) {
  const { app, guest } = row;
  const site = row.sourceName;
  const dates = app.startDate ? `${app.startDate} to ${app.endDate ?? app.startDate}` : "flexible";
  const tasks = [
    submit &&
      `Apply to this listing for ${guest.name}: open the listing, start the application / contact the host, fill in the dates (${dates}) and type %intro% as the message. Then submit.`,
    outbox.length > 0 &&
      `Send these messages from ${guest.name} to the host in the conversation, in order:\n${outbox
        .map((m, i) => `- id ${m.id}: type %message${i + 1}%`)
        .join("\n")}`,
    `Report what the site shows: whether the application is submitted, accepted or declined, and every message from the host.${
      app.externalRef ? "" : " Find the conversation or application page and pass its URL as externalRef."
    }`,
  ].filter(Boolean);

  return `You are AgentBnB's browser agent, working on ${site} (${row.sourceUrl ?? row.listing.url}) for ${guest.name}${
    interactive ? ", who is watching the browser live" : ". Nobody is watching right now"
  }.

Your tasks:
${tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Rules:
- First check whether ${guest.name} is logged in to ${site}. ${
    interactive
      ? "If not, use askUser to have them log in or sign up."
      : "If not, call giveUp with \"You're logged out of " + site + "\"; don't try to log in."
  } Never type passwords, codes or payment details yourself, and never create accounts.
- ${interactive ? "Use askUser for" : "Call giveUp on"} CAPTCHAs, email verification, membership or payment walls, and form questions you can't answer from what's below.
- Don't apply twice: if the site shows this listing was already applied to or contacted, don't submit again; report submitted: true.
- Never accept terms, pay, or confirm a booking on ${guest.name}'s behalf; only send the application and messages.
- Keep notes short and friendly; ${guest.name} reads them.

The listing: ${row.listing.title}
${row.listing.url}

About ${guest.name} (for form questions): ${[guest.bio, guest.homeCity && `from ${guest.homeCity}`, guest.languages.length > 0 && `speaks ${guest.languages.join(", ")}`]
    .filter(Boolean)
    .join("; ") || "nothing more on file"}

Their message to the host (%intro%):
${app.intro ?? ""}`;
}

// ---------------------------------------------------------------------------
// Who needs a run
// ---------------------------------------------------------------------------

/** External applications the cron should look at: due checks, unsent replies, stuck submissions. */
export async function dueApplications(limit = 25) {
  const now = new Date();
  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        eq(applications.channel, "external_auto"),
        isNull(applications.runStartedAt),
        or(
          // Approved, but no browser ever picked it up (the guest closed the tab right away).
          and(eq(applications.status, "queued"), lt(applications.updatedAt, new Date(now.getTime() - 5 * 60_000))),
          and(inArray(applications.status, [...WATCHED]), or(isNull(applications.nextCheckAt), lte(applications.nextCheckAt, now))),
          and(
            inArray(applications.status, [...WATCHED]),
            sql`exists (select 1 from ${events} where ${events.applicationId} = ${applications.id} and ${events.kind} = 'message' and ${events.data}->>'delivery' = 'pending')`,
          ),
        ),
      ),
    )
    .orderBy(asc(applications.nextCheckAt))
    .limit(limit);
  return rows.map((r) => r.id);
}
