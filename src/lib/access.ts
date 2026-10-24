// How the browser agent gets into an account on another site, once it knows it needs one.
//
// The agent first tries the task as-is (open the listing, tap Apply). Only when the site gates the
// next step behind a login or sign-up does it handle access, in this order:
//   1. already signed in (the saved browser profile): continue;
//   2. a Keychain login for the site: log in with it, without asking;
//   3. no login (or the saved one failed): create an account if the person allows it and the site
//      has free sign-up, otherwise ask the person for their login (or to log in in the browser);
//   4. anything only a human can do (CAPTCHA, 2FA code, paid membership): hand them the browser.
// Pure so it can be tested; the browser tools in browser-agent.ts act on what it returns.

export type AccessInput = {
  /** The page shows the person is logged in. */
  signedIn: boolean;
  /** The Keychain has a login for this site, and its status. */
  credential: null | { status: "active" | "unverified" | "failed" };
  /** Their "Let my agent create accounts for me" setting. */
  allowSignUp: boolean;
  /** The site lets anyone create a free account (as far as the agent can tell). */
  freeSignUp: boolean;
  /** The site said an account already exists for this email. */
  accountExists?: boolean;
  /** We have an email on their profile to sign up with. */
  hasEmail: boolean;
  /** Someone is watching and can be asked; unattended runs can only log in. */
  interactive: boolean;
  /** Something only a human can do is in the way. */
  humanOnly?: "captcha" | "two_factor" | "payment" | null;
};

export type AccessStep =
  | { step: "continue" }
  | { step: "log_in" }
  | { step: "sign_up" }
  | { step: "ask_email" }
  | { step: "ask_for_login" }
  | { step: "ask_person"; why: "captcha" | "two_factor" | "payment" }
  | { step: "give_up"; reason: string };

export function decideAccess(a: AccessInput): AccessStep {
  if (a.humanOnly) {
    return a.interactive ? { step: "ask_person", why: a.humanOnly } : { step: "give_up", reason: "needs_person" };
  }
  if (a.signedIn) return { step: "continue" };
  if (a.credential && a.credential.status !== "failed") return { step: "log_in" };
  if (!a.interactive) return { step: "give_up", reason: a.credential ? "login_failed" : "logged_out" };
  if (a.allowSignUp && a.freeSignUp && !a.accountExists && !a.credential) {
    return a.hasEmail ? { step: "sign_up" } : { step: "ask_email" };
  }
  return { step: "ask_for_login" };
}

/** What the agent is waiting for while an application is `needs_user`, stored on that status event. */
export type NeedsUserAsk = { kind: "credentials" | "email" | "browser"; site?: string; siteName?: string };

/** The ask behind the latest needs_user status change on a timeline, if any. */
export function latestAsk(
  status: string,
  timeline: { kind: string; data: Record<string, unknown> }[],
): NeedsUserAsk | null {
  if (status !== "needs_user") return null;
  const event = timeline.findLast((e) => e.kind === "status" && e.data.to === "needs_user");
  const ask = event?.data.ask as NeedsUserAsk | undefined;
  return ask && typeof ask.kind === "string" ? ask : null;
}

/** Remove any secret that slipped into text meant for the model or a log. Defense in depth. */
export function scrub<T>(value: T, secrets: string[]): T {
  const live = secrets.filter((s) => s && s.length >= 4);
  if (!live.length) return value;
  const json = JSON.stringify(value);
  let out = json;
  for (const s of live) {
    const encoded = JSON.stringify(s).slice(1, -1);
    out = out.split(encoded).join("[hidden]");
  }
  return out === json ? value : (JSON.parse(out) as T);
}
