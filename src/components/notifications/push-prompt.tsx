import Link from "next/link";
import type { ReactNode } from "react";
import { BellIcon, CheckIcon, PlusIcon, ShareIcon } from "@/components/ui/icons";
import type { PushState } from "./use-push";

// Turning on browser notifications, in the three places it's offered: a card (on /applications,
// /hosting and /me/notifications), a one-time banner on the home, and a row in the account menu.
// Props in, no fetching: `usePush()` owns the state and the browser calls.

type Actions = {
  state: PushState;
  /** iPhone / iPad: changes how to unblock notifications. */
  ios?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Must run straight from the click: it may show the browser's permission prompt. */
  onEnable: () => void;
};

const PRIMARY =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-rausch px-4 text-sm font-medium text-white transition-colors hover:bg-rausch-active disabled:cursor-not-allowed disabled:bg-rausch-disabled";
const QUIET =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium text-ink underline-offset-2 transition-colors hover:bg-surface-soft disabled:text-muted";

/** How to unblock notifications once the person (or the browser) said no. */
export function DeniedHelp({ ios = false, className = "" }: { ios?: boolean; className?: string }) {
  return (
    <p className={`text-[13px] leading-relaxed text-muted ${className}`}>
      {ios ? (
        <>
          Notifications are off for AgentBnB. Open <b className="font-semibold text-body">Settings → Notifications → AgentBnB</b> and
          allow them.
        </>
      ) : (
        <>
          Notifications are blocked for this site. Click the icon left of the address bar, open{" "}
          <b className="font-semibold text-body">Site settings</b>, set <b className="font-semibold text-body">Notifications</b> to Allow,
          then reload the page.
        </>
      )}
    </p>
  );
}

/** iPhone / iPad Safari: push needs AgentBnB on the Home Screen first (iOS 16.4 or later). */
export function IosInstallSteps({ className = "" }: { className?: string }) {
  const step = "flex items-center gap-2.5";
  const num = "flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-strong text-xs font-semibold text-ink";
  return (
    <ol className={`flex flex-col gap-2 text-sm text-body ${className}`}>
      <li className={step}>
        <span className={num}>1</span>
        <span>
          Tap <ShareIcon size={15} className="-mt-0.5 inline text-ink" aria-label="Share" /> <b className="font-semibold text-ink">Share</b> in
          Safari&apos;s toolbar
        </span>
      </li>
      <li className={step}>
        <span className={num}>2</span>
        <span>
          Choose <PlusIcon size={14} className="-mt-0.5 inline text-ink" /> <b className="font-semibold text-ink">Add to Home Screen</b>
        </span>
      </li>
      <li className={step}>
        <span className={num}>3</span>
        <span>Open AgentBnB from your Home Screen and turn notifications on</span>
      </li>
    </ol>
  );
}

/**
 * The full panel: what notifications are for, and the control for this device's state. `children`
 * go underneath (the email opt-in on /applications); `onTest` adds "Send a test" once it's on.
 */
export function PushCard({
  state,
  ios,
  busy,
  error,
  onEnable,
  onDisable,
  onTest,
  testResult,
  title = "Get notified",
  lead = "Hosts often answer within hours. I'll let you know the moment anything changes.",
  children,
}: Actions & {
  onDisable?: () => void;
  onTest?: () => void;
  testResult?: string | null;
  title?: string;
  lead?: string;
  children?: ReactNode;
}) {
  if (state === "loading") return null;
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-hairline p-5 text-sm">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rausch-soft text-rausch">
          <BellIcon size={19} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">
            {state === "ios-install" ? "Add AgentBnB to your Home Screen to get notifications" : title}
          </h2>
          <p className="mt-0.5 text-muted">
            {state === "ios-install" ? "On iPhone and iPad, notifications work once AgentBnB is on your Home Screen." : lead}
          </p>
        </div>
      </div>

      {state === "ios-install" && <IosInstallSteps className="mt-1" />}
      {state === "denied" && <DeniedHelp ios={ios} />}
      {state === "unsupported" && <p className="text-muted">This browser can&apos;t show notifications. I&apos;ll keep updates in the bell.</p>}

      {(state === "default" || state === "off" || state === "on") && (
        <div className="flex flex-wrap items-center gap-2">
          {state === "on" ? (
            <>
              <span className="inline-flex items-center gap-1.5 font-semibold text-success">
                <CheckIcon size={16} strokeWidth={2.4} /> On for this device
              </span>
              {onTest && (
                <button type="button" onClick={onTest} disabled={busy} className={`${QUIET} underline`}>
                  Send a test
                </button>
              )}
              {onDisable && (
                <button type="button" onClick={onDisable} disabled={busy} className={`${QUIET} text-muted hover:text-ink`}>
                  Turn off
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={onEnable} disabled={busy} className={PRIMARY}>
              {busy ? "Turning on…" : "Turn on notifications"}
            </button>
          )}
        </div>
      )}
      {testResult && <p className="text-[13px] text-muted" role="status">{testResult}</p>}
      {error && <p className="text-[13px] text-error" role="alert">{error}</p>}
      {children}
    </section>
  );
}

/**
 * The home's one-time nudge, once the person has something worth hearing about. "Not now" hides it
 * for good (the caller remembers that). Shows nothing for states where it can't help.
 */
export function PushBanner({ state, busy, error, onEnable, onDismiss }: Actions & { onDismiss: () => void }) {
  if (state !== "default" && state !== "off" && state !== "ios-install") return null;
  const ios = state === "ios-install";
  return (
    <section
      aria-label="Notifications"
      className="flex flex-col gap-3 rounded-[14px] border border-hairline bg-canvas p-4 motion-safe:animate-pop sm:flex-row sm:items-center sm:gap-4 sm:p-5"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rausch-soft text-rausch">
          <BellIcon size={19} />
        </span>
        <div className="min-w-0 text-sm">
          <h2 className="text-[15px] font-semibold text-ink">
            {ios ? "Add AgentBnB to your Home Screen to get notifications" : "Want a ping when a host replies?"}
          </h2>
          <p className="mt-0.5 text-muted">
            {ios
              ? "On iPhone, notifications work from the Home Screen app."
              : "Turn on notifications and I'll tell you the moment something needs you."}
          </p>
          {ios && <IosInstallSteps className="mt-3" />}
          {error && <p className="mt-1 text-[13px] text-error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
        <button type="button" onClick={onDismiss} className={QUIET}>
          {ios ? "Got it" : "Not now"}
        </button>
        {!ios && (
          <button type="button" onClick={onEnable} disabled={busy} className={PRIMARY}>
            {busy ? "Turning on…" : "Turn on"}
          </button>
        )}
      </div>
    </section>
  );
}

/** "Notifications" in the account menu: a switch for this device, plus a hint when it can't be on. */
export function PushMenuItem({
  state,
  busy,
  onEnable,
  onDisable,
  onTest,
  testResult,
  settingsHref,
  onNavigate,
}: Actions & {
  onDisable: () => void;
  onTest: () => void;
  testResult?: string | null;
  settingsHref: string;
  onNavigate: () => void;
}) {
  const on = state === "on";
  const canToggle = state === "default" || state === "off" || on;
  const hint = {
    loading: null,
    unsupported: "Not available in this browser",
    "ios-install": "Add AgentBnB to your Home Screen first",
    default: "Off on this device",
    off: "Off on this device",
    on: "On for this device",
    denied: "Blocked in browser settings",
  }[state];

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <BellIcon size={17} strokeWidth={1.9} className="shrink-0" />
        <Link href={settingsHref} onClick={onNavigate} className="min-w-0 flex-1 rounded-sm">
          <span className="block font-semibold">Notifications</span>
          {hint && <span className="block text-[13px] text-muted">{hint}</span>}
        </Link>
        {canToggle && (
          <Switch checked={on} disabled={busy} label="Notifications on this device" onChange={() => (on ? onDisable() : onEnable())} />
        )}
      </div>
      {on && (
        <div className="mt-1.5 pl-[29px] text-[13px]">
          <button type="button" onClick={onTest} className="font-semibold text-ink underline underline-offset-2 hover:text-body">
            Send a test
          </button>
          {testResult && <span className="mt-0.5 block text-muted" role="status">{testResult}</span>}
        </div>
      )}
    </div>
  );
}

/** Airbnb's toggle: an ink track when on, a strong hairline when off. */
export function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      // aria-disabled, not disabled: disabling the focused switch would blur it and close the menu around it.
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onChange()}
      className={`relative h-8 w-12 shrink-0 rounded-full transition-colors duration-200 aria-disabled:opacity-60 ${checked ? "bg-ink" : "bg-border-strong"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 flex size-7 items-center justify-center rounded-full bg-canvas shadow-float transition-transform duration-200 ${checked ? "translate-x-4" : ""}`}
      >
        {checked && <CheckIcon size={12} strokeWidth={3} className="text-ink" />}
      </span>
    </button>
  );
}
