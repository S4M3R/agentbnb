"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SparkIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";
import type { NeedsUserAsk } from "@/lib/access";
import { generateSecurePassword } from "@/lib/password";
import { LiveBrowser, ResumeBrowser, kickRuns } from "../../applications/ui";
import { loginPrefill, saveEmailAndContinue, saveLoginAndContinue, type Result } from "./actions";

// What a waiting (`needs_user`) application shows at the top, on /applications/[id], in the chat's
// side panel and on the Keychain page:
//   - the agent is waiting for a login → a secure form to save it to the Keychain (and the live
//     browser underneath, to log in themselves instead);
//   - it needs an email to create an account → an email field;
//   - anything else → the live browser (LiveBrowser), or Continue once it has closed (ResumeBrowser).
// The chat's application cards show just the form (NeedsUserForm, inline), and the chat's
// askForLogin card (src/app/login-ask.tsx) reuses the password field and prefill.
//
// Passwords stay in these components' state until the save action; they're never put in a URL,
// storage, the chat's messages or anything the model reads.

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
        <NeedsUserForm app={app} ask={ask} />
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

/** Whether a waiting application has a form (a login or an email) rather than only the browser. */
export function hasNeedsUserForm(ask: NeedsUserAsk | null | undefined) {
  return ask?.kind === "credentials" || ask?.kind === "email";
}

/**
 * Just the form a waiting application needs: its login, or an email. `inline` drops the card frame,
 * for inside the chat's application card. Null for other asks.
 */
export function NeedsUserForm({
  app,
  ask,
  inline = false,
}: {
  app: { id: string; statusMessage: string | null };
  ask: NeedsUserAsk | null;
  inline?: boolean;
}) {
  if (!ask || !hasNeedsUserForm(ask)) return null;
  const props = {
    applicationId: app.id,
    site: ask.site ?? null,
    siteName: ask.siteName ?? "this site",
    message: inline ? null : app.statusMessage,
    inline,
  };
  return ask.kind === "credentials" ? <LoginRequest {...props} /> : <EmailRequest {...props} />;
}

export function RequestCard({
  site,
  title,
  message,
  inline = false,
  children,
}: {
  site: string | null;
  title: string;
  message: string | null;
  /** No frame or icon: inside another card that already shows the site. */
  inline?: boolean;
  children: ReactNode;
}) {
  if (inline) {
    return (
      <section className="mt-3 border-t border-hairline-soft pt-3">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {message && <p className="mt-0.5 text-[13px] leading-relaxed text-body">{message}</p>}
        {children}
      </section>
    );
  }
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
  inline = false,
}: {
  applicationId: string;
  site: string | null;
  siteName: string;
  message: string | null;
  inline?: boolean;
}) {
  const id = useId();
  const [login, setLogin] = useLoginPrefill(site);
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <RequestCard site={site} title={`Save your ${siteName} login`} message={message} inline={inline}>
      <form
        className={`${inline ? "mt-3" : "mt-4"} flex flex-col gap-3`}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await saveLoginAndContinue(applicationId, { login, password, generated });
            if (!r.ok) return setError({ field: r.field, message: r.error });
            setPassword("");
            setGenerated(false);
            after(applicationId, r);
          });
        }}
      >
        <div className={`grid gap-3 ${inline ? "" : "sm:grid-cols-2"}`}>
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
            <PasswordField
              id={`${id}-password`}
              value={password}
              generated={generated}
              invalid={error?.field === "password"}
              onChange={(value, gen) => {
                setPassword(value);
                setGenerated(gen);
              }}
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
  inline = false,
}: {
  applicationId: string;
  site: string | null;
  siteName: string;
  message: string | null;
  inline?: boolean;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <RequestCard site={site} title={`Your email for ${siteName}`} message={message} inline={inline}>
      <form
        className={`${inline ? "mt-3" : "mt-4"} flex flex-col gap-3`}
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
          <p className="text-[13px] text-muted">
            Saved on your profile. Your agent signs up with it and saves the new login in your Keychain.
          </p>
          <Button type="submit" size="sm" disabled={pending || !email.trim()}>
            {pending ? "Saving…" : "Save and continue"}
          </Button>
        </div>
      </form>
    </RequestCard>
  );
}

/**
 * The login a form starts with: the one saved in the Keychain for `site`, or else the profile email.
 * Once the person types, theirs wins.
 */
export function useLoginPrefill(site: string | null, enabled = true) {
  const [login, setLogin] = useState("");
  const touched = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    loginPrefill(site).then((value) => {
      if (!stale && value && !touched.current) setLogin(value);
    });
    return () => {
      stale = true;
    };
  }, [site, enabled]);
  const change = (value: string) => {
    touched.current = true;
    setLogin(value);
  };
  return [login, change] as const;
}

/**
 * A password input with Show/Hide and "Generate a secure password". Generating happens on this
 * device (crypto.getRandomValues); the password is shown so the person can copy it, e.g. to create
 * the account themselves. `onChange`'s `generated` is true only while the value is a generated one.
 */
export function PasswordField({
  id,
  value,
  generated,
  onChange,
  invalid = false,
  autoComplete = "current-password",
}: {
  id: string;
  value: string;
  generated: boolean;
  onChange: (value: string, generated: boolean) => void;
  invalid?: boolean;
  autoComplete?: string;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [simple, setSimple] = useState(false);
  if (!value && shown) setShown(false);

  function generate(symbols: boolean) {
    onChange(generateSecurePassword({ symbols }), true);
    setShown(true);
    setCopied(false);
  }

  return (
    <div>
      <div className="relative">
        <input
          id={id}
          name="password"
          type={shown ? "text" : "password"}
          autoComplete={generated ? "new-password" : autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value, false)}
          aria-invalid={invalid}
          className={`${INPUT} pr-16 ${shown && value ? "font-mono text-[15px] tracking-wide" : ""} ${invalid ? "border-error" : "border-hairline"}`}
        />
        {value && (
          <button
            type="button"
            onClick={() => setShown(!shown)}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            className="absolute inset-y-1 right-1 rounded-md px-3 text-[13px] font-semibold text-ink underline underline-offset-2 transition-colors hover:bg-surface-strong"
          >
            {shown ? "Hide" : "Show"}
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
        <button
          type="button"
          onClick={() => generate(!simple)}
          className="inline-flex items-center gap-1.5 font-semibold text-ink underline underline-offset-2"
        >
          <SparkIcon size={14} className="text-rausch" />
          {generated ? "Generate another" : "Generate a secure password"}
        </button>
        {generated && (
          <>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(value).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
              }
              className="font-semibold text-ink underline underline-offset-2"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSimple(!simple);
                generate(simple);
              }}
              className="font-semibold text-muted underline underline-offset-2"
            >
              {simple ? "Add symbols" : "Letters and digits only"}
            </button>
          </>
        )}
      </div>
      {generated && (
        <p className="mt-1.5 text-[12px] leading-snug text-muted">
          Made on this device. Copy it if you&apos;re creating the account yourself; it&apos;s saved encrypted when you save.
        </p>
      )}
    </div>
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
