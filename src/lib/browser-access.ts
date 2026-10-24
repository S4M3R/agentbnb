import "server-only";
import type { Stagehand } from "@browserbasehq/stagehand";
import { tool } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { decideAccess, scrub, type AccessInput, type AccessStep, type NeedsUserAsk } from "@/lib/access";
import {
  entryState,
  generatePassword,
  getCredential,
  getSettings,
  markUsed,
  resolveSite,
  saveCredential,
} from "@/lib/keychain";

// The browser agent's tools for getting into an account on a site, shared by applying
// (apply-agent.ts through browser-agent.ts) and hosting (hosting/browser-agent.ts).
//
// The model never sees a password: logIn and signUp read or generate it here, hand it to Stagehand
// as an act() variable (Stagehand's model only gets the name %password%, and the value is filled in
// inside the browser after it picks the field), and tell the model only "signed_in", "filled" or
// "failed". Acts that carry a secret skip Stagehand's server-side action cache, whose key would
// otherwise include variable values. Everything returned to the model goes through scrub().

export type AccessContext = {
  userId: string;
  /** Source id of the site (the Keychain's `site` for marketplaces). */
  sourceId: string;
  siteName: string;
  stagehand: Stagehand;
  /** Show the person what's happening; throws or ends the run if they stopped it. */
  step(note: string): Promise<void>;
  /** Hand the browser to the person and wait. Undefined when nobody is watching. */
  ask?: (message: string, ask: NeedsUserAsk) => Promise<"continue" | "stop">;
  /** The site took the login: remember the browser session as connected. */
  onSignedIn?: () => Promise<void>;
};

type PageState = {
  signedIn: boolean;
  error: string | null;
  blocker: "none" | "captcha" | "two_factor" | "email_verification" | "payment";
  accountExists: boolean;
};

const STATE_QUESTION =
  "After submitting the login or sign-up form, what does the page show? Answer with exactly one of these words, then " +
  "a colon and the page's error message if there is one: SIGNED_IN (account menu, avatar, dashboard or log out link, " +
  "no login form), CAPTCHA, TWO_FACTOR (asks for a code), EMAIL_VERIFICATION (check your email), PAYMENT (payment or " +
  "paid membership), ACCOUNT_EXISTS (an account already exists for this email), ERROR (wrong login or another error), " +
  "or UNKNOWN.";

/** Read Stagehand's one-word answer to STATE_QUESTION. */
export function parsePageState(answer: string): PageState {
  const text = answer.trim();
  const word = text.match(/\b(SIGNED_IN|CAPTCHA|TWO_FACTOR|EMAIL_VERIFICATION|PAYMENT|ACCOUNT_EXISTS|ERROR|UNKNOWN)\b/)?.[1] ?? "UNKNOWN";
  const error = text.includes(":") ? text.slice(text.indexOf(":") + 1).trim().slice(0, 200) || null : null;
  const blocker = ({ CAPTCHA: "captcha", TWO_FACTOR: "two_factor", EMAIL_VERIFICATION: "email_verification", PAYMENT: "payment" } as const)[
    word as "CAPTCHA"
  ];
  return { signedIn: word === "SIGNED_IN", error, blocker: blocker ?? "none", accountExists: word === "ACCOUNT_EXISTS" };
}

/** Stagehand's extract() without a schema answers in `extraction`. */
function answerText(data: unknown) {
  if (data && typeof data === "object" && "extraction" in data) return String((data as { extraction: unknown }).extraction ?? "");
  return typeof data === "string" ? data : JSON.stringify(data ?? "");
}

function nextStep(s: AccessStep, siteName: string) {
  switch (s.step) {
    case "continue":
      return "You're signed in; continue the task.";
    case "log_in":
      return "Call logIn.";
    case "sign_up":
    case "ask_email":
      return "Open the site's free sign-up form, then call signUp.";
    case "ask_for_login":
      return "Call askForLogin.";
    case "ask_person":
      return `Call askUser so the person can handle the ${s.why.replace("_", " ")} in the window.`;
    case "give_up":
      return `Call giveUp with "You're logged out of ${siteName}. Open the application to sign in."`;
  }
}

export function accessTools(ctx: AccessContext) {
  const { userId, sourceId, siteName, stagehand } = ctx;
  const interactive = !!ctx.ask;
  const note = z.string().describe('What you\'re doing, shown to the person, e.g. "Logging you in to Workaway".');

  async function decide(partial: Partial<AccessInput>) {
    const [entry, settings, [user]] = await Promise.all([
      entryState(userId, sourceId),
      getSettings(userId),
      db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)),
    ]);
    return decideAccess({
      signedIn: false,
      credential: entry && { status: entry.status },
      allowSignUp: settings.allowSignUp,
      freeSignUp: false,
      hasEmail: !!user?.email,
      interactive,
      ...partial,
    });
  }

  /** Type into a field with secret variables. True if Stagehand found the field. */
  async function fill(instruction: string, variables: Record<string, string>) {
    try {
      const { data } = await stagehand.act(instruction, { timeout: 45_000, variables, cache: false });
      return data.success;
    } catch {
      return false;
    }
  }

  async function pageState(secrets: string[]): Promise<PageState> {
    await new Promise((r) => setTimeout(r, 2500)); // let the submit land
    try {
      const { data } = await stagehand.extract(STATE_QUESTION);
      return scrub(parsePageState(answerText(data)), secrets);
    } catch {
      return { signedIn: false, error: null, blocker: "none", accountExists: false };
    }
  }

  const tools = {
    logIn: tool({
      description:
        `Log in to ${siteName} with the person's saved Keychain login. Only call it once the site actually requires being ` +
        "logged in for the next step (a login page or modal, or 'log in to apply'), with the login form open " +
        "(open it with act first if needed). It fills the login and password itself; you never see them. " +
        "Returns signed_in, needs_person, failed, or no_saved_login, with what to do next.",
      inputSchema: z.object({
        note,
        freeSignUp: z
          .boolean()
          .describe("Whether the site offers a free way to create an account (Sign up / Join for free) that you can see."),
      }),
      execute: async ({ note, freeSignUp }) => {
        await ctx.step(note);
        const cred = await getCredential(userId, sourceId);
        if (!cred || cred.status === "failed") {
          return {
            result: cred ? "saved_login_failed_before" : "no_saved_login",
            next: nextStep(await decide({ freeSignUp }), siteName),
          };
        }
        const secrets = [cred.password];
        const vars = { login: cred.login, password: cred.password };
        if (!(await fill("type %login% into the email or username field of the login form", vars))) {
          return { result: "failed", next: "The login form isn't showing. Open it with act (click Log in), then call logIn again." };
        }
        if (!(await fill("type %password% into the password field of the login form", vars))) {
          // Two-step logins (email, Next, then password).
          await stagehand.act("click the Next or Continue button of the login form", { timeout: 30_000 }).catch(() => {});
          if (!(await fill("type %password% into the password field of the login form", vars))) {
            return { result: "failed", next: "Couldn't find the password field. Check the page with read." };
          }
        }
        await stagehand.act("click the button that submits the login form", { timeout: 30_000 }).catch(() => {});
        const state = await pageState(secrets);
        if (state.signedIn) {
          await markUsed(userId, sourceId, "active");
          await ctx.onSignedIn?.();
          return { result: "signed_in", next: "Continue the task." };
        }
        if (state.blocker === "captcha" || state.blocker === "two_factor") {
          await markUsed(userId, sourceId, cred.status);
          return {
            result: "needs_person",
            next: nextStep(await decide({ humanOnly: state.blocker }), siteName),
          };
        }
        if (state.blocker === "email_verification") {
          return { result: "needs_person", next: `Call askUser: "Open the email from ${siteName} and click the link in it, then tap Continue."` };
        }
        await markUsed(userId, sourceId, "failed");
        return {
          result: "failed",
          siteSays: state.error,
          next: nextStep(await decide({ freeSignUp: false, accountExists: true }), siteName),
        };
      },
    }),
  };

  if (!interactive) return tools;

  return {
    ...tools,
    signUp: tool({
      description:
        `Create a free ${siteName} account for the person. Only when the site requires an account, logIn said next is ` +
        "signUp, and the free sign-up form is open. It types their email and a strong password it generates (you never see " +
        "it) and saves the login to their Keychain. Then you fill the other required fields (name, country, ...), tick a " +
        "required terms checkbox for the free account, submit, and check the result with read. Never choose a paid plan.",
      inputSchema: z.object({
        note,
        username: z.string().max(40).optional().describe("Only if the form asks for a username: the one to use."),
      }),
      execute: async ({ note, username }) => {
        await ctx.step(note);
        const settings = await getSettings(userId);
        if (!settings.allowSignUp) {
          return { result: "not_allowed", next: "They turned off account creation. Call askForLogin." };
        }
        const entry = await entryState(userId, sourceId);
        if (entry && entry.status !== "failed") return { result: "has_login", next: "There's a saved login: call logIn." };

        const loadEmail = async () =>
          (await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)))[0]?.email;
        let email = await loadEmail();
        if (!email) {
          const answer = await ctx.ask!(`Add your email so I can create your account on ${siteName}.`, {
            kind: "email",
            site: sourceId,
            siteName,
          });
          if (answer !== "continue") return { result: "stopped" };
          email = await loadEmail();
          if (!email) return { result: "failed", next: "Still no email. Call askForLogin." };
        }

        const password = generatePassword();
        const vars = { email, password, ...(username && { username }) };
        if (!(await fill("type %email% into the email field of the sign-up form", vars))) {
          return { result: "failed", next: "The sign-up form isn't showing. Open it with act, then call signUp again." };
        }
        if (!(await fill("type %password% into the password field of the sign-up form", vars))) {
          return { result: "failed", next: "Couldn't find the password field. Check the form with read." };
        }
        const confirm = await stagehand
          .extract("Does the sign-up form have a second field to repeat or confirm the password? Answer YES or NO.")
          .then(({ data }) => /\byes\b/i.test(answerText(data)))
          .catch(() => false);
        if (confirm) {
          await fill("type %password% into the confirm password (repeat password) field of the sign-up form", vars);
        }
        if (username) await fill("type %username% into the username field of the sign-up form", vars);

        const site = await resolveSite(sourceId);
        if (!site) return { result: "failed", next: "Call askForLogin." };
        await saveCredential({
          userId,
          site,
          login: email,
          password,
          createdBy: "agent",
          status: "unverified",
          notes: username ? `Username: ${username}` : null,
        });
        return {
          result: "filled",
          next:
            "Email and password are filled and saved to their Keychain. Fill the other required fields, submit, then read the " +
            `result. If ${siteName} sends a verification email, call askUser to have them click the link. If it says the ` +
            "email already has an account, call askForLogin.",
        };
      },
    }),
    askForLogin: tool({
      description:
        `Ask the person for their ${siteName} login, when the site requires an account and there's no saved login (or it ` +
        "failed) and you can't or may not create one. They get a secure form that saves it to their Keychain, or can log " +
        "in themselves in the live browser. Returns when they're done. Never ask for a password anywhere else.",
      inputSchema: z.object({
        message: z
          .string()
          .describe(`Short, e.g. "${siteName} needs you to be logged in to apply. Save your ${siteName} login and I'll sign in for you."`),
      }),
      execute: async ({ message }) => {
        const asked = new Date(Date.now() - 1000);
        const answer = await ctx.ask!(message, { kind: "credentials", site: sourceId, siteName });
        if (answer !== "continue") return { personSays: "Stop." };
        const entry = await entryState(userId, sourceId);
        if (entry && entry.updatedAt >= asked && entry.status !== "failed") {
          return { personSays: "I saved my login.", next: "Open the login form if it isn't showing, then call logIn." };
        }
        return { personSays: "Done in the browser.", next: "Check with read whether they're logged in now, then continue." };
      },
    }),
  };
}

/** Mark logins the agent created for a site as working, once a run there succeeded while signed in. */
export async function confirmAgentLogin(userId: string, sourceId: string) {
  const entry = await entryState(userId, sourceId);
  if (entry?.status === "unverified") await markUsed(userId, sourceId, "active");
}

/** The rules every browser agent prompt gets about accounts. */
export function accessRules({ siteName, person, interactive }: { siteName: string; person: string; interactive: boolean }) {
  return `Accounts and logging in (only when needed):
- Start with the task as it is: open the page and go for the button. Don't check whether ${person} is logged in first; many sites show listings and forms without an account.
- Only when ${siteName} actually blocks the next step behind a login or sign-up (a login page or modal, "log in to apply"), handle access in this order:
  1. If the page already shows ${person} is logged in, just continue.
  2. Call logIn: it uses their saved Keychain login without asking them. Follow its "next".
  3. ${
    interactive
      ? `No saved login: if logIn says so, create a free account with signUp; otherwise call askForLogin so they can save their login (or log in themselves in the window).`
      : `No saved login, or it failed: call giveUp with "You're logged out of ${siteName}. Open the application to sign in."`
  }
  4. ${interactive ? "Use askUser" : "Call giveUp"} for what only a human can do: CAPTCHAs, 2FA or one-time codes, clicking an email verification link, or a paid membership. Never pay, start a trial or pick a paid plan.
- You never see passwords and must never type one, a code or card details with act. logIn and signUp fill them for you. Never put a password in a note or message.`;
}
