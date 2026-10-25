"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";

/** The networks shown being checked when the agent didn't narrow the search to some of them. */
const NETWORKS: [id: string, name: string][] = [
  ["internal", "AgentBnB hosts"],
  ["couchsurfing", "Couchsurfing"],
  ["bewelcome", "BeWelcome"],
  ["trustroots", "Trustroots"],
  ["couchers", "Couchers.org"],
  ["warmshowers", "Warmshowers"],
  ["trustedhousesitters", "TrustedHousesitters"],
  ["nomador", "Nomador"],
  ["mindmyhouse", "MindMyHouse"],
  ["workaway", "Workaway"],
  ["worldpackers", "Worldpackers"],
  ["helpx", "HelpX"],
];
const NAMES = Object.fromEntries(NETWORKS);

/** Fired when a live search lands with results; the chat shows Couchbot happy for a moment. */
export const COUCHBOT_FOUND = "agentbnb:couchbot-found";

/** How long each network takes to "check" while the search runs, and once results are in. */
const STEP_MS = 420;
const FINISH_STEP_MS = 55;
/** The beat between the last tick and the results replacing the placeholders. */
const SETTLE_MS = 320;

/**
 * Wraps a search's results: shows <SearchProgress> while it runs and, when the results land,
 * lets it tick off the remaining networks quickly before showing them, so even a fast search
 * reads as "checked everywhere". A search that was already done when it mounted (an earlier
 * turn, a reloaded chat) shows its results straight away.
 */
export function LiveSearch({
  done,
  found = false,
  location,
  sources,
  children,
}: {
  done: boolean;
  /** Results came back: Couchbot cheers when they appear (see COUCHBOT_FOUND). */
  found?: boolean;
  location?: string;
  sources?: (string | undefined)[];
  children: ReactNode;
}) {
  const [holding, setHolding] = useState(!done);
  // stable, so the chat re-rendering on every streamed word doesn't restart the settle timer
  const release = useCallback(() => {
    setHolding(false);
    if (found) window.dispatchEvent(new Event(COUCHBOT_FOUND));
  }, [found]);
  if (done && !holding) return children;
  return <SearchProgress location={location} sources={sources} finishing={done} onFinished={release} />;
}

/**
 * The search in flight: each network lights up as it's checked, then gets a tick, while
 * placeholder cards shimmer where the results will land. The search is one request, so the
 * pacing is for show: `finishing` (results are in) runs through the rest quickly and then calls
 * `onFinished`; until then it waits on "Picking the best fits".
 */
export function SearchProgress({
  location,
  sources,
  finishing = false,
  onFinished,
}: {
  location?: string;
  /** While the tool input streams in, entries can still be undefined. */
  sources?: (string | undefined)[];
  finishing?: boolean;
  onFinished?: () => void;
}) {
  const named = sources?.flatMap((s) => (s && NAMES[s] ? [[s, NAMES[s]] as [string, string]] : []));
  const networks = named?.length ? named : NETWORKS;
  const count = networks.length;
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, count)), finishing ? FINISH_STEP_MS : STEP_MS);
    return () => clearInterval(timer);
  }, [finishing, count]);

  const current = Math.min(step, count);
  const allChecked = current >= count;

  useEffect(() => {
    if (!finishing || !allChecked || !onFinished) return;
    const timer = setTimeout(onFinished, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [finishing, allChecked, onFinished]);

  const label = !allChecked
    ? `Checking ${networks[current][1]}…`
    : finishing
      ? "Done"
      : "Picking the best fits…";

  return (
    <section aria-label="Searching" className="@container flex flex-col gap-3">
      <div className="flex flex-col gap-2.5" role="status">
        <p className="text-sm font-semibold text-ink">
          {location ? `Searching ${location}` : "Searching"}
          <span className="font-normal text-muted"> · </span>
          {/* keyed so each new network's name fades in */}
          <span key={label} className="font-normal text-muted motion-safe:animate-fade-in">
            {label}
          </span>
        </p>
        <ul className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
          {networks.map(([id], i) => {
            const state = i < current ? "done" : i === current ? "active" : "waiting";
            return (
              <li
                key={id}
                className={`relative flex size-8 items-center justify-center rounded-[10px] border transition-[opacity,filter,border-color,background-color] duration-300 ${
                  state === "waiting"
                    ? "border-hairline-soft bg-surface-soft opacity-45 grayscale"
                    : state === "active"
                      ? "border-rausch bg-canvas motion-safe:animate-network-check"
                      : "border-hairline-soft bg-canvas"
                }`}
              >
                <SiteIcon site={id} size={18} />
                {state === "done" && (
                  <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-success-dot text-white ring-2 ring-canvas motion-safe:animate-tick-in">
                    <CheckIcon size={9} strokeWidth={3.4} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {/* the same rail as the results, so they land where these shimmer */}
      <ul className="no-scrollbar -mx-4 flex gap-4 overflow-hidden px-4 pb-1 sm:mx-0 sm:px-0 @2xl:gap-6" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex w-[268px] shrink-0 flex-col gap-3 @2xl:w-[calc((100%-3rem)/3)]">
            <div className="skeleton aspect-[20/19] w-full rounded-card" style={{ animationDelay: `${i * 120}ms` }} />
            <div className="skeleton h-4 w-3/4 rounded-md" style={{ animationDelay: `${i * 120 + 60}ms` }} />
            <div className="skeleton h-3.5 w-1/2 rounded-md" style={{ animationDelay: `${i * 120 + 120}ms` }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
