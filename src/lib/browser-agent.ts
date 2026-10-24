import Browserbase from "@browserbasehq/sdk";
import { browserbase, Stagehand, type ModelName, type StagehandBrowser } from "@browserbasehq/stagehand";
import { generateText, hasToolCall, isStepCount, tool } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { agentModel } from "@/lib/agent/model";

// A browser agent that does one task on an external site as one of our users: an AI SDK tool
// loop driving Stagehand in a Browserbase session the user can watch live and take over.
//
// The session runs on the user's saved browser context for that site (stored as
// user_source_accounts.credential_ref), so they log in once and stay logged in across runs.
// Anything only the person should do (log in, CAPTCHA, pay) goes through `askUser`, which waits
// until they tap Continue. Import this only from routes that trace Stagehand's assets (see
// next.config.ts): Stagehand loads its browser extension from disk.

const { userSourceAccounts } = schema;

export class BrowserAgentError extends Error {}

export type AskResult = "continue" | "stopped" | "user_finished" | "timeout";

export type BrowserRun<Result> =
  | { kind: "finished"; result: Result }
  | { kind: "gave_up"; reason: string }
  | { kind: "out_of_time" }
  | { kind: "stopped" }
  | { kind: "user_finished" };

export type BrowserTask<F extends z.ZodType> = {
  userId: string;
  sourceId: string;
  startUrl: string;
  /** System prompt: the job, the rules, what we know. */
  instructions: string;
  prompt: string;
  /** Long text the agent can type with %name% instead of repeating it in tool calls. */
  variables?: Record<string, string>;
  /** The tool that ends the run successfully; its input becomes `result`. */
  finish: { description: string; inputSchema: F };
  budgetMs: number;
  metadata?: Record<string, string>;
  /** The browser is up; show the live view. */
  onLive(sessionId: string, liveViewUrl: string): Promise<void>;
  /** A progress note for the user. Return false if they stopped the run. */
  onNote(note: string): Promise<boolean>;
  /** Hand the browser to the user and wait for them. Omit for unattended runs (no one is watching). */
  askUser?: (message: string, deadline: number) => Promise<AskResult>;
  /** Always called at the end, whatever happened. */
  onClose(): Promise<void>;
};

function config() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new BrowserAgentError("Browserbase isn't connected yet, so I can't open other sites.");
  return { apiKey, projectId: process.env.BROWSERBASE_PROJECT_ID };
}

/** The user's saved browser profile for a site, so they only log in once. */
async function siteContext(bb: Browserbase, userId: string, sourceId: string, projectId?: string) {
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

export async function markConnected(userId: string, sourceId: string) {
  await db
    .update(userSourceAccounts)
    .set({ status: "connected", connectedAt: new Date() })
    .where(and(eq(userSourceAccounts.userId, userId), eq(userSourceAccounts.sourceId, sourceId)));
}

function stagehandModel() {
  const modelName = process.env.STAGEHAND_MODEL as ModelName | undefined;
  // Unset: Browserbase's Model Gateway picks a model per action.
  return modelName ? { modelName, apiKey: process.env.STAGEHAND_MODEL_API_KEY } : undefined;
}

export async function runBrowserTask<F extends z.ZodType>(task: BrowserTask<F>): Promise<BrowserRun<z.infer<F>>> {
  let browser: StagehandBrowser | undefined;
  let stagehand: Stagehand | undefined;
  try {
    const { apiKey, projectId } = config();
    const bb = new Browserbase({ apiKey });
    const contextId = await siteContext(bb, task.userId, task.sourceId, projectId);
    browser = await browserbase.launch({
      apiKey,
      projectId,
      api_timeout: Math.ceil(task.budgetMs / 1000) + 60,
      browserSettings: { context: { id: contextId, persist: true }, blockAds: true },
      userMetadata: task.metadata,
    });
    const live = await bb.sessions.debug(browser.sessionId!);
    await task.onLive(browser.sessionId!, live.debuggerFullscreenUrl);

    stagehand = await Stagehand.create({ browser, model: stagehandModel() });
    const page = (await browser.context.pages())[0] ?? (await browser.context.newPage());
    await page.goto(task.startUrl);
    return await drive(task, stagehand, browser);
  } finally {
    await stagehand?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await task.onClose();
  }
}

async function drive<F extends z.ZodType>(
  task: BrowserTask<F>,
  stagehand: Stagehand,
  browser: StagehandBrowser,
): Promise<BrowserRun<z.infer<F>>> {
  const deadline = Date.now() + task.budgetMs - 20_000;
  const halt = new AbortController();
  let outcome: BrowserRun<z.infer<F>> | undefined;

  function end(o: BrowserRun<z.infer<F>>) {
    outcome = o;
    halt.abort();
  }

  async function step(note: string) {
    if (!(await task.onNote(note))) end({ kind: "stopped" });
  }

  async function currentPage() {
    return (await browser.context.activePage()) ?? (await browser.context.pages())[0];
  }

  const note = z.string().describe('What you\'re doing, shown to the user, e.g. "Filling in your message".');
  const vars = Object.keys(task.variables ?? {});

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
        'Do one thing on the page, described in plain words: "click the Apply button", "type %intro% into the message box".' +
        (vars.length ? ` Available variables: ${vars.map((v) => `%${v}%`).join(", ")}.` : ""),
      inputSchema: z.object({ instruction: z.string(), note }),
      execute: async ({ instruction, note }) => {
        await step(note);
        const { data } = await stagehand.act(instruction, { timeout: 45_000, variables: task.variables });
        const page = await currentPage();
        return { success: data.success, message: data.message, url: await page.url() };
      },
    }),
    read: tool({
      description:
        "Ask a question about what's on the page right now: whether the user is logged in, which fields a form has, " +
        "error messages, messages in a conversation, the status of an application, etc.",
      inputSchema: z.object({ question: z.string() }),
      execute: async ({ question }) => {
        const page = await currentPage();
        const { data } = await stagehand.extract(question);
        return { url: await page.url(), answer: data };
      },
    }),
    ...(task.askUser && {
      askUser: tool({
        description:
          "Hand the browser to the user for something only they should do: log in, sign up, verify email, solve a " +
          "CAPTCHA, accept terms, pay, or answer something you don't know. They see the live browser. " +
          "Returns once they tap Continue.",
        inputSchema: z.object({
          message: z.string().describe('Short and specific, e.g. "Log in to Workaway in the window, then tap Continue."'),
        }),
        execute: async ({ message }) => {
          const answer = await task.askUser!(message, deadline);
          if (answer === "continue") {
            const page = await currentPage();
            return { userSays: "Done, continue.", url: await page.url() };
          }
          end(answer === "timeout" ? { kind: "out_of_time" } : { kind: answer });
          return { userSays: "Stop." };
        },
      }),
    }),
    finish: tool({
      description: task.finish.description,
      inputSchema: task.finish.inputSchema,
      execute: async (result: z.infer<F>) => {
        outcome = { kind: "finished", result };
        return { ok: true };
      },
    }),
    giveUp: tool({
      description: "Call when it can't be done and the user couldn't fix it from the browser either.",
      inputSchema: z.object({ reason: z.string().describe("One sentence for the user.") }),
      execute: async ({ reason }) => {
        outcome = { kind: "gave_up", reason };
        return { ok: true };
      },
    }),
  };

  try {
    await generateText({
      model: agentModel,
      instructions: task.instructions,
      prompt: task.prompt,
      tools,
      stopWhen: [hasToolCall("finish", "giveUp"), isStepCount(60)],
      abortSignal: AbortSignal.any([halt.signal, AbortSignal.timeout(Math.max(deadline - Date.now(), 1000))]),
    });
  } catch (err) {
    if (outcome) return outcome;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return { kind: "out_of_time" };
    throw err;
  }
  return outcome ?? { kind: "gave_up", reason: "I couldn't finish in the browser. Try again." };
}
