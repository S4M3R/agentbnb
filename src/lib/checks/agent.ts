import { openai } from "@ai-sdk/openai";
import { gateway, hasToolCall, isStepCount, streamText, tool } from "ai";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { CheckProfile, GuestSnapshot } from "@/db/schema";
import { agentModel } from "@/lib/agent/model";
import { notify } from "@/lib/notify";
import { readPage } from "./read-page";

// The background-check agent. It looks the guest up on the open web, writes what it finds into
// the check as it goes (so the host watches the profile fill in), and finishes with a verdict.
// Scope is identity and consistency of public information. No criminal, court or credit records.

const { backgroundChecks: checks, backgroundCheckFindings: findings, backgroundCheckEvents: events } = schema;

const TIME_LIMIT_MS = 270_000;
const MAX_STEPS = 40;
/** How long before the time limit the agent is made to write its report. */
const WRAP_UP_MS = 50_000;

export async function logEvent(checkId: string, kind: string, message: string, url?: string | null) {
  await db.insert(events).values({ checkId, kind, message, url: url ?? null });
}

function hostOf(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : ""}`;
  } catch {
    return url;
  }
}

/** The web search tool for whichever provider runs the model; both run on the provider's side. */
function webSearchTool() {
  return process.env.OPENAI_API_KEY
    ? openai.tools.webSearch({ searchContextSize: "medium" })
    : gateway.tools.perplexitySearch({ maxResults: 8 });
}

/** What AgentBnB itself knows about a member guest. Not declines from other hosts: those aren't a signal. */
async function internalHistory(guestUserId: string) {
  const { users, applications } = schema;
  const [[user], byStatus, [stays]] = await Promise.all([
    db
      .select({ memberSince: users.createdAt, verified: users.verified, homeCity: users.homeCity })
      .from(users)
      .where(eq(users.id, guestUserId)),
    db
      .select({ status: sql<string>`${applications.status}::text`, n: count() })
      .from(applications)
      .where(eq(applications.userId, guestUserId))
      .groupBy(applications.status),
    db
      .select({ n: count() })
      .from(applications)
      .where(
        and(
          eq(applications.userId, guestUserId),
          sql`${applications.status}::text in ('accepted', 'scheduled')`,
          sql`${applications.endDate} < current_date`,
        ),
      ),
  ]);
  if (!user) return null;
  const n = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;
  return {
    memberSince: user.memberSince.toISOString().slice(0, 10),
    verified: user.verified,
    homeCity: user.homeCity,
    pastStays: stays?.n ?? 0,
    cancelledByGuest: n("cancelled"),
  };
}

function instructions() {
  return `You run background checks for AgentBnB hosts. A host has a stay request from someone and wants to know, before saying yes, whether this person is who they say they are and whether anything public about them is worrying. You investigate the open web and build a short, sourced profile for the host.

Scope. You check identity and consistency of public information only.
- Never look up or record criminal records, court cases, arrests, sex-offender registries, credit, debts, immigration status, or anything behind a login.
- Never record or infer health, religion, ethnicity, sexual orientation, politics or union membership, even if a page mentions them.
- Never look for their home address, phone number, family members or employer contact details.
- Having little or no online presence is not a red flag. Many good guests barely exist online. Say so plainly.

Namesakes. Most names are shared by many people. Only attribute a page to the guest when something specific links it: the same username, a link to or from their platform profile, the same photo, or the same name together with the same city and occupation or story. If a page might be them but nothing links it, either skip it or record it as a low-confidence "possible match" and say why. Never mix two people into one profile.

How to work.
1. Read their profile on the platform the request came from with readPage, if there's a URL. Many platforms need a login; if so, note that and use what the request already shows.
2. Search the web (web_search): their name with their city, their username, their name with the platform name, and with what they say about themselves (job, trip, hobby). Usually 4 to 8 searches. Open promising results with readPage when the search snippet isn't enough.
3. Look for the same person on other couch-surfing and travel platforms (Couchsurfing, BeWelcome, Trustroots, Warmshowers, Workaway, TrustedHousesitters) and on public professional or social profiles.
4. As you learn things, save them immediately; the host is watching the profile fill in live:
   - updateProfile whenever you learn who they are (name, one-line headline, location, occupation, languages, profiles you're confident are theirs, how sure you are it's all one person).
   - recordFinding for each fact worth telling the host, with the URL it came from. Facts from the request itself or AgentBnB's records use sourceTitle "Request" or "AgentBnB" and no URL.
5. Finish with finishReport. Call it exactly once, as your last step.

What counts as a red flag: the identity doesn't hold together (different names, ages or photos for the same profile), a photo that belongs to someone else, public reports of scams or of bad behaviour as a guest or host, a profile flagged by a platform, or pressure tactics like asking to pay or talk off-platform. Not red flags: being young, being new to a platform (mention it as a gap), nationality, travel style, or having no social media.

Writing. Plain, neutral, factual English. Short sentences. No speculation, no adjectives about their character. Every finding must be something a host could verify from the source.`;
}

function prompt(input: {
  guest: GuestSnapshot;
  source: string;
  message: string | null;
  dates: string | null;
  listingCity: string | null;
  history: Awaited<ReturnType<typeof internalHistory>>;
}) {
  const g = input.guest;
  const lines = [
    `The request came in on ${input.source}.`,
    `Guest as shown by ${input.source}:`,
    `- Name: ${g.name}`,
    g.username && `- Username: ${g.username}`,
    g.profileUrl && `- Profile: ${g.profileUrl}`,
    g.location && `- Says they're from: ${g.location}`,
    g.age && `- Age: ${g.age}`,
    g.memberSince && `- Member since: ${g.memberSince}`,
    g.references != null && `- References: ${g.references}`,
    g.verified != null && `- Verified by the platform: ${g.verified ? "yes" : "no"}`,
    g.languages?.length && `- Languages: ${g.languages.join(", ")}`,
    g.about && `- About them, in their words: ${g.about}`,
    input.dates && `Dates requested: ${input.dates}`,
    input.listingCity && `The host's place is in ${input.listingCity}.`,
    input.message && `Their message to the host:\n"""\n${input.message}\n"""`,
    input.history &&
      `AgentBnB's own records for this guest (they're a member): member since ${input.history.memberSince}, ${
        input.history.verified ? "verified" : "not verified"
      }, ${input.history.pastStays} completed stays through AgentBnB, ${input.history.cancelledByGuest} stays they cancelled.`,
    "",
    "Run the check.",
  ];
  return lines.filter((l) => l !== false && l !== null && l !== undefined && l !== 0 && l !== "").join("\n");
}

function tools(checkId: string) {
  return {
    web_search: webSearchTool(),

    readPage: tool({
      description:
        "Open a public web page and read its text: a platform profile, a search result, a blog. " +
        "Returns the title, description, share image and up to 8000 characters of text. Pages behind a login come back with loginRequired.",
      inputSchema: z.object({ url: z.url().describe("Full http(s) URL.") }),
      execute: async ({ url }) => {
        await logEvent(checkId, "read", `Reading ${hostOf(url)}`, url);
        const page = await readPage(url);
        if (!page.ok) await logEvent(checkId, "note", `Couldn't read ${hostOf(url)}: ${page.error}`, url);
        else if (page.loginRequired) await logEvent(checkId, "note", `${hostOf(url)} needs a login`, url);
        return page;
      },
    }),

    updateProfile: tool({
      description:
        "Save what you've learned about who the guest is. Only the fields you pass are changed; `profiles` " +
        "is merged by URL. Call it as soon as you learn something, not only at the end.",
      inputSchema: z.object({
        name: z.string().optional(),
        headline: z.string().max(160).optional().describe('One line, e.g. "Product designer from Berlin, travels by bike".'),
        location: z.string().optional(),
        occupation: z.string().optional(),
        languages: z.array(z.string()).optional(),
        identity: z
          .enum(["strong", "partial", "weak", "unknown"])
          .optional()
          .describe("How sure you are that everything in this profile is the same person."),
        profiles: z
          .array(
            z.object({
              platform: z.string().describe('e.g. "Couchsurfing", "LinkedIn", "Personal site".'),
              url: z.url(),
              note: z.string().max(160).optional().describe('e.g. "112 references since 2014".'),
            }),
          )
          .optional()
          .describe("Profiles you're confident belong to the guest."),
      }),
      execute: async (patch) => {
        const [row] = await db.select({ profile: checks.profile }).from(checks).where(eq(checks.id, checkId));
        const current: CheckProfile = row?.profile ?? {};
        const byUrl = new Map((current.profiles ?? []).map((p) => [p.url, p]));
        for (const p of patch.profiles ?? []) byUrl.set(p.url, { ...byUrl.get(p.url), ...p });
        const { profiles: _ignored, ...fields } = patch;
        const next: CheckProfile = {
          ...current,
          ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
          profiles: [...byUrl.values()],
        };
        await db.update(checks).set({ profile: next }).where(eq(checks.id, checkId));

        const added = (patch.profiles ?? []).filter((p) => !current.profiles?.some((c) => c.url === p.url));
        const what = [
          ...added.map((p) => `${p.platform} profile`),
          patch.headline && "who they are",
          patch.identity && patch.identity !== current.identity && `identity: ${patch.identity}`,
        ].filter(Boolean);
        if (what.length) await logEvent(checkId, "profile", `Updated profile: ${what.join(", ")}`);
        return { ok: true };
      },
    }),

    recordFinding: tool({
      description: "Add one sourced fact to the host's report. Call it for each fact as you find it.",
      inputSchema: z.object({
        category: z.enum(schema.findingCategory.enumValues),
        title: z.string().max(140).describe('Short and specific, e.g. "14 positive references on Trustroots since 2019".'),
        detail: z.string().max(800).optional().describe("One or two sentences of context."),
        sourceUrl: z.url().optional().describe("Where a host can verify it. Omit only for facts from the request or AgentBnB."),
        sourceTitle: z.string().max(120).optional(),
        confidence: z.enum(schema.findingConfidence.enumValues),
      }),
      execute: async (f) => {
        await db.insert(findings).values({ checkId, ...f });
        await logEvent(checkId, "finding", f.title, f.sourceUrl);
        return { ok: true };
      },
    }),

    finishReport: tool({
      description: "Finish the check with your overall verdict. Call exactly once, last.",
      inputSchema: z.object({
        verdict: z
          .enum(schema.backgroundCheckVerdict.enumValues)
          .describe("consistent: what we found lines up. some_gaps: nothing wrong, not much to go on. red_flags: something worrying."),
        summary: z.string().max(400).describe("One or two sentences for the host."),
        questions: z.array(z.string().max(200)).max(4).describe("Things worth asking the guest before saying yes."),
        unverified: z.array(z.string().max(200)).max(6).describe("What you looked for and couldn't confirm."),
      }),
      execute: async (r) => {
        await db
          .update(checks)
          .set({ ...r, status: "done", finishedAt: new Date() })
          .where(eq(checks.id, checkId));
        await logEvent(checkId, "done", "Check complete");
        return { ok: true };
      },
    }),
  };
}

function searchQueries(input: unknown, output: unknown): string[] {
  const i = input as { query?: string | string[] } | undefined;
  const o = output as { action?: { type?: string; query?: string; queries?: string[] } } | undefined;
  if (o?.action?.type === "search") return o.action.queries ?? (o.action.query ? [o.action.query] : []);
  if (i?.query) return Array.isArray(i.query) ? i.query : [i.query];
  return [];
}

/** Run a check that `startCheck` created. Writes progress, findings and the verdict as it goes. */
export async function runCheck(checkId: string) {
  const { incomingRequests: requests, sources, listings } = schema;
  const [row] = await db
    .select({ request: requests, sourceName: sources.name, listingCity: listings.city })
    .from(checks)
    .innerJoin(requests, eq(requests.id, checks.requestId))
    .innerJoin(sources, eq(sources.id, requests.sourceId))
    .leftJoin(listings, eq(listings.id, requests.listingId))
    .where(eq(checks.id, checkId));
  if (!row) return;

  const r = row.request;
  const fail = async (message: string) => {
    await db
      .update(checks)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(and(eq(checks.id, checkId), eq(checks.status, "running")));
    await logEvent(checkId, "error", message);
  };

  try {
    const history = r.guestUserId ? await internalHistory(r.guestUserId) : null;
    if (history) await logEvent(checkId, "note", "Checked their AgentBnB history");

    const startedAt = Date.now();
    const result = streamText({
      model: agentModel,
      instructions: instructions(),
      prompt: prompt({
        guest: r.guest,
        source: row.sourceName,
        message: r.message,
        dates: r.startDate ? `${r.startDate} to ${r.endDate ?? r.startDate}` : null,
        listingCity: row.listingCity,
        history,
      }),
      tools: tools(checkId),
      // Every step calls a tool, so the only way out is finishReport; near the limits we force it.
      toolChoice: "required",
      prepareStep: ({ stepNumber }) =>
        stepNumber >= MAX_STEPS - 1 || Date.now() - startedAt > TIME_LIMIT_MS - WRAP_UP_MS
          ? { toolChoice: { type: "tool", toolName: "finishReport" }, activeTools: ["finishReport"] }
          : {},
      stopWhen: [hasToolCall("finishReport"), isStepCount(MAX_STEPS)],
      abortSignal: AbortSignal.timeout(TIME_LIMIT_MS),
      onStepEnd: async ({ stepNumber }) => {
        await db.update(checks).set({ steps: stepNumber + 1 }).where(eq(checks.id, checkId));
      },
    });

    // Provider-run searches don't go through our execute(), so log them from the stream.
    for await (const part of result.stream) {
      if (part.type === "tool-result" && part.toolName === "web_search") {
        for (const q of searchQueries(part.input, part.output)) {
          await logEvent(checkId, "search", `Searched the web for “${q}”`);
        }
      } else if (part.type === "error") {
        throw part.error;
      }
    }

    const [after] = await db.select({ status: checks.status }).from(checks).where(eq(checks.id, checkId));
    if (after?.status === "running") await fail("The check stopped before writing its summary. Run it again.");
  } catch (err) {
    console.error("background check failed", checkId, err);
    const aborted = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    await fail(aborted ? "The check ran out of time. Run it again." : "Something went wrong while checking. Run it again.");
  }
  await notifyHost(checkId, r.id, r.guest.name).catch((err) => console.error("check notify failed", checkId, err));
}

const VERDICT = { consistent: "Looks consistent", some_gaps: "Some gaps", red_flags: "Red flags" } as const;

/** The host asked for the check and may have left the page: tell them it's done (or failed). */
async function notifyHost(checkId: string, requestId: string, guestName: string) {
  const [c] = await db
    .select({ hostUserId: checks.requestedBy, status: checks.status, verdict: checks.verdict, summary: checks.summary, error: checks.error })
    .from(checks)
    .where(eq(checks.id, checkId));
  if (!c || c.status === "running") return;
  const done = c.status === "done";
  await notify(c.hostUserId, {
    title: done
      ? `Check on ${guestName} is ready${c.verdict ? `: ${VERDICT[c.verdict]}` : ""}`
      : `Check on ${guestName} didn't finish`,
    body: (done ? c.summary : c.error) ?? undefined,
    url: `/requests/${requestId}`,
    tag: `check:${checkId}`,
  });
}
