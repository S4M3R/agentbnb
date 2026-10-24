import Browserbase from "@browserbasehq/sdk";
import { browserbase, Stagehand, type ModelName, type StagehandBrowser } from "@browserbasehq/stagehand";
import { generateText, hasToolCall, isStepCount, tool } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { agentModel } from "@/lib/agent/model";
import { accessRules, accessTools } from "@/lib/browser-access";
import { getHostListing, HostingError, type HostListing } from "./listings";
import { ARRANGEMENT_LABEL, getNetwork, type Network } from "./networks";
import { updatePublication as update } from "./publications";

// Publishing a host's listing to an external network with a browser agent.
//
// Each attempt ("run") opens a Browserbase session on the host's saved context for that network
// (cookies persist between runs, so they log in once), shows its live view in the chat, and lets
// an AI SDK tool loop drive Stagehand. Logging in only happens when the network asks for it, with
// the shared access tools (browser-access.ts): the host's Keychain login, a new free account if
// they allow it, or asking them. Anything only the host can do (CAPTCHA, 2FA, pay) goes through
// `askHost`: the run waits while the host acts in the live view and taps Continue. Runs happen in `after()` on a route with maxDuration 300, so each one fits in
// RUN_BUDGET_MS; if time runs out the host taps Continue and a fresh run picks up from there.

const { listings, listingPublications: pubs, userSourceAccounts } = schema;

const RUN_BUDGET_MS = 270_000;

const POLL_MS = 2500;

function browserbaseConfig() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new HostingError("Browserbase isn't connected yet, so I can't open other sites.");
  return { apiKey, projectId: process.env.BROWSERBASE_PROJECT_ID };
}

/** The host's saved browser profile for a network, so they only log in once. */
async function networkContext(bb: Browserbase, userId: string, sourceId: string, projectId?: string) {
  const [account] = await db
    .select()
    .from(userSourceAccounts)
    .where(and(eq(userSourceAccounts.userId, userId), eq(userSourceAccounts.sourceId, sourceId)));
  if (account?.credentialRef) return account.credentialRef;

  const context = await bb.contexts.create({ projectId });
  await db
    .insert(userSourceAccounts)
    .values({ userId, sourceId, credentialRef: context.id })
    .onConflictDoUpdate({
      target: [userSourceAccounts.userId, userSourceAccounts.sourceId],
      set: { credentialRef: context.id },
    });
  return context.id;
}

function stagehandModel() {
  const modelName = process.env.STAGEHAND_MODEL as ModelName | undefined;
  // Unset: Browserbase's Model Gateway picks a model per action.
  return modelName ? { modelName, apiKey: process.env.STAGEHAND_MODEL_API_KEY } : undefined;
}

/** Run one attempt. Never throws; the outcome is written to the publication row. */
export async function runPublication(publicationId: string) {
  const [row] = await db
    .select({ pub: pubs, hostUserId: listings.hostUserId })
    .from(pubs)
    .innerJoin(listings, eq(listings.id, pubs.listingId))
    .where(eq(pubs.id, publicationId));
  const network = row && getNetwork(row.pub.sourceId);
  if (!row?.hostUserId || !network) return;
  const userId = row.hostUserId;

  let browser: StagehandBrowser | undefined;
  let stagehand: Stagehand | undefined;
  try {
    const listing = await getHostListing(userId, row.pub.listingId);
    const { apiKey, projectId } = browserbaseConfig();
    const bb = new Browserbase({ apiKey });
    const contextId = await networkContext(bb, userId, network.id, projectId);

    browser = await browserbase.launch({
      apiKey,
      projectId,
      api_timeout: Math.ceil(RUN_BUDGET_MS / 1000) + 60,
      browserSettings: { context: { id: contextId, persist: true }, blockAds: true },
      userMetadata: { publicationId },
    });
    const live = await bb.sessions.debug(browser.sessionId!);
    await update(publicationId, {
      browserSessionId: browser.sessionId,
      liveViewUrl: live.debuggerFullscreenUrl,
      statusMessage: `Opening ${network.name}…`,
    });

    stagehand = await Stagehand.create({ browser, model: stagehandModel() });
    const page = (await browser.context.pages())[0] ?? (await browser.context.newPage());
    await page.goto(network.startUrl);

    const outcome = await driveBrowser({ publicationId, userId, network, listing, stagehand, browser });
    const now = new Date();
    if (outcome.kind === "published") {
      await update(publicationId, {
        status: "live",
        statusMessage: outcome.summary,
        externalUrl: outcome.externalUrl ?? null,
        publishedAt: row.pub.publishedAt ?? now,
        lastSyncedAt: now,
      });
      await db
        .update(userSourceAccounts)
        .set({ status: "connected", connectedAt: now })
        .where(and(eq(userSourceAccounts.userId, userId), eq(userSourceAccounts.sourceId, network.id)));
    } else if (outcome.kind === "gave_up") {
      await update(publicationId, { status: "failed", error: outcome.reason, statusMessage: outcome.reason });
    } else if (outcome.kind === "out_of_time") {
      await update(publicationId, {
        status: "needs_user",
        statusMessage: "I ran out of time in this browser session. Tap Continue and I'll pick up where I left off.",
      });
    }
    // "stopped" and "host_finished" were already written by the host's action.
  } catch (err) {
    if (!(err instanceof HostingError)) console.error("publication run failed", publicationId, err);
    await update(publicationId, {
      status: "failed",
      error: err instanceof HostingError ? err.message : "The browser session broke. Try again.",
      statusMessage: null,
    });
  } finally {
    await stagehand?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await update(publicationId, { browserSessionId: null, liveViewUrl: null });
  }
}

type Outcome =
  | { kind: "published"; externalUrl?: string; summary: string }
  | { kind: "gave_up"; reason: string }
  | { kind: "out_of_time" }
  | { kind: "stopped" }
  | { kind: "host_finished" };

function listingBrief(l: HostListing) {
  return [
    `Title: ${l.title}`,
    `What it is: ${ARRANGEMENT_LABEL[l.arrangement]}; ${l.type.replace("_", " ")}`,
    `Area (public): ${l.publicLocation ?? "unknown"}. Never type the street address; use the neighborhood and city.`,
    l.maxGuests && `Max guests: ${l.maxGuests}`,
    l.dates.length && `Available: ${l.dates.map((d) => `${d.start} to ${d.end}`).join(", ")}`,
    l.pets && `Pets: ${l.pets}`,
    l.amenities.length && `Amenities: ${l.amenities.join(", ")}`,
    l.houseRules && `House rules:\n${l.houseRules}`,
    `Description:\n${l.description}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function driveBrowser({
  publicationId,
  userId,
  network,
  listing,
  stagehand,
  browser,
}: {
  publicationId: string;
  userId: string;
  network: Network;
  listing: HostListing;
  stagehand: Stagehand;
  browser: StagehandBrowser;
}): Promise<Outcome> {
  const deadline = Date.now() + RUN_BUDGET_MS - 20_000;
  const halt = new AbortController();
  let outcome: Outcome | undefined;

  function end(o: Outcome) {
    outcome = o;
    halt.abort();
  }

  /** Shared by every tool: show the host what's happening, and notice Stop. */
  async function step(note: string) {
    const [p] = await db
      .update(pubs)
      .set({ statusMessage: note })
      .where(and(eq(pubs.id, publicationId), eq(pubs.status, "running")))
      .returning({ id: pubs.id });
    if (!p) end({ kind: "stopped" });
  }

  async function currentPage() {
    return (await browser.context.activePage()) ?? (await browser.context.pages())[0];
  }

  const note = z.string().describe('What you\'re doing, shown to the host, e.g. "Filling in your description".');

  /** Hand the browser to the host and wait for Continue; ends the run if they stop or time runs out. */
  async function waitForHost(message: string): Promise<"continue" | "stop"> {
    const asked = new Date();
    await update(publicationId, { status: "needs_user", statusMessage: message });
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const [p] = await db
        .select({ status: pubs.status, userActedAt: pubs.userActedAt })
        .from(pubs)
        .where(eq(pubs.id, publicationId));
      if (p.status === "live") end({ kind: "host_finished" });
      else if (p.status === "failed") end({ kind: "stopped" });
      else if (p.userActedAt && p.userActedAt >= asked) return "continue";
      else continue;
      return "stop";
    }
    end({ kind: "out_of_time" });
    return "stop";
  }

  const tools = {
    goto: tool({
      description: "Open a URL in the browser.",
      inputSchema: z.object({ url: z.url(), note }),
      execute: async ({ url, note }) => {
        await step(note);
        const page = await currentPage();
        await page.goto(url);
        return { url: await page.url(), title: await page.title() };
      },
    }),
    act: tool({
      description:
        'Do one thing on the page, described in plain words: "click the Save button", ' +
        '"type %description% into the About your place field". Use %description% to insert the full listing description.',
      inputSchema: z.object({ instruction: z.string(), note }),
      execute: async ({ instruction, note }) => {
        await step(note);
        const { data } = await stagehand.act(instruction, {
          timeout: 45_000,
          variables: { description: listing.description ?? "" },
        });
        const page = await currentPage();
        return { success: data.success, message: data.message, url: await page.url() };
      },
    }),
    read: tool({
      description:
        "Ask a question about what's on the page right now: whether the user is logged in, which fields a form has, " +
        "error messages, the profile URL, etc.",
      inputSchema: z.object({ question: z.string() }),
      execute: async ({ question }) => {
        const page = await currentPage();
        const { data } = await stagehand.extract(question);
        return { url: await page.url(), answer: data };
      },
    }),
    askHost: tool({
      description:
        "Hand the browser to the host for something only they can do: solve a CAPTCHA, enter a 2FA code, click an email " +
        "verification link, decide on a paid membership, accept the network's hosting terms, or choose something the " +
        "listing doesn't say. They see the live browser. Returns once they tap Continue. For logins use logIn, signUp or askForLogin.",
      inputSchema: z.object({
        message: z.string().describe('Short and specific, e.g. "Solve the CAPTCHA in the window, then tap Continue."'),
      }),
      execute: async ({ message }) => {
        if ((await waitForHost(message)) !== "continue") return { hostSays: "Stop." };
        const page = await currentPage();
        return { hostSays: "Done, continue.", url: await page.url() };
      },
    }),
    // The hosting card has no login or email form: point the host to the Keychain, then Continue.
    ...accessTools({
      userId,
      sourceId: network.id,
      siteName: network.name,
      stagehand,
      step,
      ask: (message, ask) =>
        waitForHost(
          ask.kind === "credentials"
            ? `${message} Save your ${network.name} login in Keychain (account menu), or log in in the window, then tap Continue.`
            : ask.kind === "email"
              ? `${message} Add it in Keychain (account menu), then tap Continue.`
              : message,
        ),
      onSignedIn: async () => {
        await db
          .update(userSourceAccounts)
          .set({ status: "connected", connectedAt: new Date() })
          .where(and(eq(userSourceAccounts.userId, userId), eq(userSourceAccounts.sourceId, network.id)));
      },
    }),
    finish: tool({
      description: "Call once the listing is saved and visible on the network.",
      inputSchema: z.object({
        externalUrl: z.url().optional().describe("Public URL of the listing or host profile."),
        summary: z.string().describe('One sentence for the host, e.g. "You\'re hosting on Trustroots, up to 2 guests."'),
      }),
      execute: async ({ externalUrl, summary }) => {
        outcome = { kind: "published", externalUrl, summary };
        return { ok: true };
      },
    }),
    giveUp: tool({
      description: "Call when it can't be done and the host can't fix it from the browser either.",
      inputSchema: z.object({ reason: z.string().describe("One sentence for the host.") }),
      execute: async ({ reason }) => {
        outcome = { kind: "gave_up", reason };
        return { ok: true };
      },
    }),
  };

  try {
    await generateText({
      model: agentModel,
      instructions: `You are AgentBnB's browser agent. You publish a host's place on ${network.name} (${network.url}) in a real browser that the host is watching live.

Rules:
- Use askHost for choices the listing doesn't answer (and for the human-only steps below).
- Fill in the hosting details from the listing below and save. Keep the host's wording; adapt length to the field. Skip photo uploads (tell the host in your summary if the site wanted photos).
- If the listing already exists there, update it to match instead of creating a duplicate.
- Check the result with read, then call finish with the public URL. Call giveUp only if it truly can't be done.
- Keep notes short and friendly; the host reads them.

${accessRules({ siteName: network.name, person: "the host", interactive: true }).replaceAll("askUser", "askHost")}

How ${network.name} works:
${network.guide}

The listing:
${listingBrief(listing)}`,
      prompt: `The browser is open at ${network.startUrl}. Publish the listing.`,
      tools,
      stopWhen: [hasToolCall("finish", "giveUp"), isStepCount(60)],
      abortSignal: AbortSignal.any([halt.signal, AbortSignal.timeout(Math.max(deadline - Date.now(), 1000))]),
    });
  } catch (err) {
    if (outcome) return outcome;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return { kind: "out_of_time" };
    throw err;
  }
  return outcome ?? { kind: "gave_up", reason: `I couldn't finish on ${network.name}. Tap Retry to try again.` };
}
