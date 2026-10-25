"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { PushSetup } from "../notifications";
import { continueInBrowser, markNotificationsRead, postMessage, saveEmail } from "./actions";

type Result = { ok: true } | { ok: false; error: string };

// Button and field styles from DESIGN.md: 8px radius, Rausch for the one primary action, ink outline
// for the rest, and inputs whose hairline turns into a 2px ink border on focus.
const BUTTON = "inline-flex h-10 shrink-0 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors";
const PRIMARY = `${BUTTON} bg-rausch text-white hover:bg-rausch-active disabled:cursor-not-allowed disabled:bg-rausch-disabled`;
const SECONDARY = `${BUTTON} border border-ink bg-canvas text-ink hover:bg-surface-soft disabled:cursor-not-allowed disabled:border-border-strong disabled:text-muted`;
const INPUT =
  "h-10 min-w-0 flex-1 rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--color-ink)]";

/** Start browser runs for external applications. Safe to repeat: the server skips ones with nothing to do. */
export function kickRuns(ids: string[], force?: boolean) {
  if (!ids.length) return;
  fetch("/api/applications/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ids.slice(0, 10), force }),
  }).catch(() => {});
}

/** Kick runs on mount and whenever `state` changes (e.g. draft → queued after Send). */
export function KickRuns({ ids, state }: { ids: string[]; state?: string }) {
  const key = ids.join(",");
  useEffect(() => {
    kickRuns(key ? key.split(",") : []);
  }, [key, state]);
  return null;
}

/** Re-render the server page every few seconds while it's visible, so new events show up. */
export function LiveRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && router.refresh();
    const t = setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, everyMs]);
  return null;
}

/** Mark this application's notifications read once the person has seen it. */
export function MarkRead({ applicationId }: { applicationId?: string }) {
  useEffect(() => {
    markNotificationsRead(applicationId);
  }, [applicationId]);
  return null;
}

/** A button that runs a server action and shows its error inline. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  confirm,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "text";
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const styles = {
    primary: PRIMARY,
    secondary: SECONDARY,
    text: "text-sm font-semibold text-ink underline underline-offset-2 hover:text-body disabled:text-muted",
  };
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={styles[variant]}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          start(async () => {
            const r = await action();
            if (!r.ok) setError(r.error);
          });
        }}
      >
        {pending ? "…" : children}
      </button>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
      className={SECONDARY}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function ReplyBox({
  applicationId,
  placeholder,
  viaBrowser,
  onSent,
}: {
  applicationId: string;
  placeholder: string;
  /** External application: the reply goes out through the browser agent. */
  viaBrowser?: boolean;
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function send() {
    const t = text.trim();
    if (!t || pending) return;
    start(async () => {
      const r = await postMessage(applicationId, t);
      if (!r.ok) return setError(r.error);
      setText("");
      if (viaBrowser) kickRuns([applicationId]);
      onSent?.();
    });
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex items-end gap-2 rounded-2xl border border-hairline bg-canvas p-2 transition-[border-color,box-shadow] focus-within:border-ink focus-within:shadow-[inset_0_0_0_1px_var(--color-ink)]">
        <textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="field-sizing-content max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={!text.trim() || pending}
          className="inline-flex h-9 shrink-0 items-center rounded-full bg-ink px-4 text-sm font-medium text-white transition-colors hover:bg-body disabled:cursor-not-allowed disabled:bg-hairline disabled:text-muted"
        >
          Send
        </button>
      </div>
      {error && <span className="text-xs text-error">{error}</span>}
    </form>
  );
}

export function ScheduleForm({ action }: { action: (arrival: string) => Promise<Result> }) {
  const [arrival, setArrival] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!arrival.trim()) return;
        start(async () => {
          const r = await action(arrival);
          if (!r.ok) setError(r.error);
        });
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        value={arrival}
        onChange={(e) => setArrival(e.currentTarget.value)}
        placeholder="Arrival, e.g. Friday around 6pm"
        className={INPUT}
      />
      <button type="submit" disabled={!arrival.trim() || pending} className={PRIMARY}>
        Confirm arrival
      </button>
      {error && <span className="w-full text-xs text-error">{error}</span>}
    </form>
  );
}

/**
 * The agent's browser while it works on its own (applying, sending a reply, checking for news): the live
 * Browserbase view to watch, or a placeholder of the same size while the session starts. The guest can
 * click in to help; when the agent needs them, LiveBrowser / ResumeBrowser take over instead.
 */
export function WatchBrowser({ url, site, message }: { url: string | null; site: string; message: string | null }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-hairline shadow-float">
      <div className="flex items-center gap-3 border-b border-hairline-soft px-4 py-3 text-sm">
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-rausch motion-safe:animate-ping motion-safe:opacity-60" />
          <span className="relative size-2.5 rounded-full bg-rausch" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{url ? `Your agent is on ${site}` : `Opening ${site}…`}</div>
          {message && <div className="truncate text-muted">{message}</div>}
        </div>
        {url && <span className="shrink-0 text-xs text-muted max-sm:hidden">Live · click in to help</span>}
      </div>
      {url ? (
        <iframe
          src={url}
          title={`Live browser on ${site}`}
          sandbox="allow-same-origin allow-scripts"
          allow="clipboard-read; clipboard-write"
          className="aspect-[4/3] w-full bg-surface-strong"
        />
      ) : (
        <div className="aspect-[4/3] w-full bg-surface-soft motion-safe:animate-shimmer" aria-hidden="true" />
      )}
    </div>
  );
}

/** The browser agent's live Browserbase session, which the guest can take over. */
export function LiveBrowser({ applicationId, url, message }: { applicationId: string; url: string; message: string | null }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-hairline shadow-float">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-rausch-soft px-4 py-3">
        <div className="text-sm">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <span className="size-2 rounded-full bg-rausch" />
            Your turn in the browser
          </div>
          <div className="text-body">{message ?? "Log in or answer the question, then tap Continue."}</div>
        </div>
        <ActionButton variant="primary" action={() => continueInBrowser(applicationId)}>
          Continue
        </ActionButton>
      </div>
      <iframe
        src={url}
        title="Live browser"
        sandbox="allow-same-origin allow-scripts"
        allow="clipboard-read; clipboard-write"
        className="aspect-[4/3] w-full bg-surface-strong"
      />
    </div>
  );
}

/**
 * The agent needs the guest but its browser has closed (it ran out of time, or the session ended).
 * Continue marks it as handled and starts a fresh run, which reopens the browser where it left off.
 */
export function ResumeBrowser({ applicationId, message }: { applicationId: string; message: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-rausch-soft px-4 py-3">
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-center gap-2 font-semibold text-ink">
          <span className="size-2 rounded-full bg-rausch" />
          Your agent is waiting for you
        </div>
        <div className="text-body">{message ?? "Tap Continue and your agent picks up where it left off."}</div>
      </div>
      <ActionButton
        variant="primary"
        action={async () => {
          const r = await continueInBrowser(applicationId);
          if (r.ok) {
            kickRuns([applicationId]);
            window.dispatchEvent(new Event("agentbnb:applications-changed"));
          }
          return r;
        }}
      >
        Continue
      </ActionButton>
    </div>
  );
}

/** "Get updates" panel: browser push on this device (the shared card), plus email. */
export function NotifySetup({ email }: { email: string | null }) {
  return (
    <PushSetup title="Don't miss a reply" hideWhenOn>
      {!email && <EmailOptIn />}
    </PushSetup>
  );
}

/** "Email me updates too": saves the person's email, which every notification is also sent to. */
export function EmailOptIn() {
  const [pending, start] = useTransition();
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setEmailError(null);
        start(async () => {
          const r = await saveEmail(emailInput);
          if (!r.ok) setEmailError(r.error);
        });
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        type="email"
        value={emailInput}
        onChange={(e) => setEmailInput(e.currentTarget.value)}
        placeholder="Email me updates too"
        aria-label="Email"
        className={INPUT}
      />
      <button type="submit" disabled={!emailInput.trim() || pending} className={SECONDARY}>
        Save
      </button>
      {emailError && <span className="w-full text-xs text-error">{emailError}</span>}
    </form>
  );
}
