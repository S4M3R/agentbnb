"use client";

import Link from "next/link";
import { useId, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SiteIcon } from "@/components/ui/site-name";
import type { NeedsUserAsk } from "@/lib/access";
import { LiveBrowser, ResumeBrowser, kickRuns } from "../../applications/ui";
import { saveEmailAndContinue, saveLoginAndContinue, type Result } from "./actions";

// What a waiting (`needs_user`) application shows at the top, on /applications/[id], in the chat's
// side panel and on the Keychain page:
//   - the agent is waiting for a login → a secure form to save it to the Keychain (and the live
//     browser underneath, to log in themselves instead);
//   - it needs an email to create an account → an email field;
//   - anything else → the live browser (LiveBrowser), or Continue once it has closed (ResumeBrowser).

export const INPUT =
  "h-12 w-full rounded-lg border bg-canvas px-3.5 text-[16px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--color-ink)]";

const CHANGED = "agentbnb:applications-changed";

export function NeedsUserBlock({
  app,
  ask,
}: {
  app: { id: string; liveViewUrl: string | null; statusMessage: string | null };
  ask: NeedsUserAsk | null;
}) {
  const live = app.liveViewUrl;
  if (ask?.kind === "credentials" || ask?.kind === "email") {
    const siteName = ask.siteName ?? "this site";
    return (
      <div className="flex flex-col gap-4">
        {ask.kind === "credentials" ? (
          <LoginRequest applicationId={app.id} site={ask.site ?? null} siteName={siteName} message={app.statusMessage} />
        ) : (
          <EmailRequest applicationId={app.id} site={ask.site ?? null} siteName={siteName} message={app.statusMessage} />
        )}
        {live && (
          <LiveBrowser
            applicationId={app.id}
            url={live}
            message={ask.kind === "credentials" ? `Or log in to ${siteName} yourself in the window, then tap Continue.` : null}
          />
        )}
      </div>
    );
  }
  return live ? (
    <LiveBrowser applicationId={app.id} url={live} message={app.statusMessage} />
  ) : (
    <ResumeBrowser applicationId={app.id} message={app.statusMessage} />
  );
}

function RequestCard({
  site,
  title,
  message,
  children,
}: {
  site: string | null;
  title: string;
  message: string | null;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-hairline bg-canvas p-5 shadow-float">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-strong">
          <SiteIcon site={site} size={22} />
        </span>
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <span className="size-2 shrink-0 rounded-full bg-rausch" />
            {title}
          </h3>
          {message && <p className="mt-0.5 text-sm leading-relaxed text-body">{message}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function after(applicationId: string, r: Result) {
  if (!r.ok) return;
  kickRuns([applicationId]); // the browser may have closed while it waited
  window.dispatchEvent(new Event(CHANGED));
}

/** "Save your Workaway login": encrypted into the Keychain, then the run signs in with it. */
export function LoginRequest({
  applicationId,
  site,
  siteName,
  message,
}: {
  applicationId: string;
  site: string | null;
  siteName: string;
  message: string | null;
}) {
  const id = useId();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <RequestCard site={site} title={`Save your ${siteName} login`} message={message}>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await saveLoginAndContinue(applicationId, { login, password });
            if (!r.ok) return setError({ field: r.field, message: r.error });
            setPassword("");
            after(applicationId, r);
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email or username" htmlFor={`${id}-login`}>
            <input
              id={`${id}-login`}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={login}
              onChange={(e) => setLogin(e.currentTarget.value)}
              className={`${INPUT} ${error?.field === "login" ? "border-error" : "border-hairline"}`}
            />
          </Field>
          <Field label="Password" htmlFor={`${id}-password`}>
            <input
              id={`${id}-password`}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              className={`${INPUT} ${error?.field === "password" ? "border-error" : "border-hairline"}`}
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-error">
            {error.message}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SecretNote />
          <Button type="submit" size="sm" disabled={pending || !login.trim() || !password}>
            {pending ? "Saving…" : "Save and continue"}
          </Button>
        </div>
      </form>
    </RequestCard>
  );
}

/** The agent needs an email to create the account. */
export function EmailRequest({
  applicationId,
  site,
  siteName,
  message,
}: {
  applicationId: string;
  site: string | null;
  siteName: string;
  message: string | null;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <RequestCard site={site} title={`Your email for ${siteName}`} message={message}>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await saveEmailAndContinue(applicationId, email);
            if (!r.ok) return setError(r.error);
            after(applicationId, r);
          });
        }}
      >
        <Field label="Email" htmlFor={`${id}-email`}>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            className={`${INPUT} ${error ? "border-error" : "border-hairline"}`}
          />
        </Field>
        {error && (
          <p role="alert" className="text-[13px] text-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">Your agent signs up with it and saves the new login in your Keychain.</p>
          <Button type="submit" size="sm" disabled={pending || !email.trim()}>
            {pending ? "Saving…" : "Save and continue"}
          </Button>
        </div>
      </form>
    </RequestCard>
  );
}

export function SecretNote() {
  return (
    <p className="text-[13px] leading-snug text-muted">
      Encrypted in your{" "}
      <Link href="/me/keychain" className="font-semibold text-ink underline underline-offset-2">
        Keychain
      </Link>
      . Your agent signs in with it; the AI never sees your password.
    </p>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}
