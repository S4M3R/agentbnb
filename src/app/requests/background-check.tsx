"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckJson } from "./check-types";

// The background check panel. Before a check it explains what will happen; while it runs it
// polls the check and shows the profile and findings filling in; afterwards it's the report.

type Finding = CheckJson["findings"][number];
type CheckEvent = CheckJson["events"][number];

const POLL_MS = 1500;

const VERDICT = {
  consistent: { label: "Looks consistent", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-600" },
  some_gaps: { label: "Some gaps", tone: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-500" },
  red_flags: { label: "Red flags", tone: "bg-[#fff1f0] text-[#b32505] ring-[#ffd1da]", dot: "bg-[#c13515]" },
} as const;

const SECTIONS: { key: Finding["category"]; title: string }[] = [
  { key: "red_flag", title: "Red flags" },
  { key: "identity", title: "Identity" },
  { key: "reputation", title: "Reputation" },
  { key: "presence", title: "Online presence" },
];

const IDENTITY = {
  strong: { label: "Strong match", bars: 4 },
  partial: { label: "Partial match", bars: 2 },
  weak: { label: "Weak match", bars: 1 },
  unknown: { label: "Not established", bars: 0 },
} as const;

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function count(events: CheckEvent[], kind: string, one: string, many: string) {
  const n = events.filter((e) => e.kind === kind).length;
  return `${n} ${n === 1 ? one : many}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function BackgroundCheck({
  requestId,
  guestName,
  guestIsMember,
  initial,
}: {
  /** Null for the guest's read-only view. */
  requestId: string | null;
  guestName: string;
  guestIsMember: boolean;
  initial: CheckJson | null;
}) {
  const [check, setCheck] = useState<CheckJson | null>(initial);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastEvent = useRef(initial?.events.at(-1)?.id ?? 0);

  const running = check?.status === "running";
  const checkId = check?.id;

  useEffect(() => {
    if (!running || !checkId) return;
    let cancelled = false;
    const tick = async () => {
      const res = await fetch(`/api/v1/background-checks/${checkId}?after=${lastEvent.current}`, { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const { check: next }: { check: CheckJson } = await res.json();
      if (cancelled) return;
      lastEvent.current = next.events.at(-1)?.id ?? lastEvent.current;
      setCheck((prev) => {
        const seen = new Set(prev?.events.map((e) => e.id));
        return { ...next, events: [...(prev?.events ?? []), ...next.events.filter((e) => !seen.has(e.id))] };
      });
    };
    const timer = setInterval(tick, POLL_MS);
    tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, checkId]);

  async function run() {
    if (!requestId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/requests/${requestId}/background-check`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Couldn't start the check.");
      const full = await fetch(`/api/v1/background-checks/${body.check.id}`, { cache: "no-store" }).then((r) => r.json());
      lastEvent.current = full.check.events.at(-1)?.id ?? 0;
      setCheck(full.check);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the check.");
    } finally {
      setStarting(false);
    }
  }

  const first = guestName.split(/\s+/)[0];

  if (!check) {
    return (
      <section className="rounded-[14px] border border-[#ddd] p-6">
        <h2 className="text-[22px] font-medium tracking-[-0.44px]">Background check</h2>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[#3f3f3f]">
          I&apos;ll search the public web for {first}: their profile on this platform, the same person on other
          networks, references and reviews, and anything that doesn&apos;t add up. You&apos;ll watch their profile
          build as I find things. It takes a minute or two.
        </p>
        <ul className="mt-4 space-y-1.5 text-[14px] text-[#6a6a6a]">
          <li>Public information only. No criminal, court or credit records, nothing behind a login.</li>
          {guestIsMember && <li>{first} is an AgentBnB member and can see what the check finds.</li>}
          <li>The report is deleted 30 days after you answer or the stay ends.</li>
        </ul>
        {requestId && (
          <button
            type="button"
            onClick={run}
            disabled={starting}
            className="mt-6 h-12 rounded-lg bg-[#ff385c] px-6 text-base font-medium text-white hover:bg-[#e00b41] active:bg-[#e00b41] disabled:bg-[#ffd1da]"
          >
            {starting ? "Starting…" : `Run background check`}
          </button>
        )}
        {error && <p className="mt-3 text-[14px] text-[#c13515]">{error}</p>}
      </section>
    );
  }

  const profile = check.profile;
  const findingsBy = (key: Finding["category"]) => check.findings.filter((f) => f.category === key);
  const done = check.status === "done";
  const verdict = done && check.verdict ? VERDICT[check.verdict] : null;
  const anyFindings = check.findings.length > 0;

  return (
    <section className="rounded-[14px] border border-[#ddd]">
      <style href="abnb-check-in" precedence="default">{`
        @keyframes abnb-check-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        .abnb-in { animation: abnb-check-in 240ms cubic-bezier(0.2, 0, 0, 1) both }
        @media (prefers-reduced-motion: reduce) { .abnb-in { animation: none } }
      `}</style>

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebebeb] px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[22px] font-medium tracking-[-0.44px]">
            {requestId ? "Background check" : "What the host saw"}
          </h2>
          {running && (
            <span className="inline-flex items-center gap-2 rounded-full bg-[#f7f7f7] px-3 py-1 text-[12px] font-semibold text-[#3f3f3f]">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ff385c] opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-[#ff385c]" />
              </span>
              Investigating
            </span>
          )}
          {verdict && (
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ${verdict.tone}`}>
              <span className={`size-2 rounded-full ${verdict.dot}`} />
              {verdict.label}
            </span>
          )}
        </div>
        {requestId && !running && (
          <button
            type="button"
            onClick={run}
            disabled={starting}
            className="text-[14px] font-medium text-[#222] underline underline-offset-2 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Run again"}
          </button>
        )}
      </header>

      <div className="space-y-8 px-6 py-6">
        {done && check.summary && <p className="text-[17px] leading-relaxed text-[#222]">{check.summary}</p>}
        {check.status === "failed" && (
          <p className="rounded-lg bg-[#fff1f0] px-4 py-3 text-[14px] text-[#b32505]">
            {check.error ?? "The check didn't finish."}
            {anyFindings && " What it found before stopping is below."}
          </p>
        )}

        <ProfileCard profile={profile} fallbackName={guestName} running={running} />

        {running && <Activity events={check.events} live />}

        {SECTIONS.map(({ key, title }) => {
          const items = findingsBy(key);
          if (!items.length) return null;
          return (
            <div key={key}>
              <h3 className={`text-[16px] font-semibold ${key === "red_flag" ? "text-[#c13515]" : ""}`}>{title}</h3>
              <ul className="mt-3 divide-y divide-[#ebebeb]">
                {items.map((f) => (
                  <FindingRow key={f.id} f={f} />
                ))}
              </ul>
            </div>
          );
        })}

        {running && !anyFindings && (
          <p className="text-[14px] text-[#6a6a6a]">Findings will appear here as soon as I have them.</p>
        )}

        {done && check.questions.length > 0 && (
          <div>
            <h3 className="text-[16px] font-semibold">Worth asking {first}</h3>
            <ul className="mt-3 space-y-2">
              {check.questions.map((q) => (
                <li key={q} className="flex gap-3 text-[15px] leading-relaxed text-[#3f3f3f]">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[#222]" />
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}

        {done && check.unverified.length > 0 && (
          <div>
            <h3 className="text-[16px] font-semibold">Couldn&apos;t verify</h3>
            <ul className="mt-3 space-y-2">
              {check.unverified.map((u) => (
                <li key={u} className="flex gap-3 text-[15px] leading-relaxed text-[#6a6a6a]">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full border border-[#929292]" />
                  {u}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!running && check.events.length > 0 && (
          <details className="group rounded-lg bg-[#f7f7f7] px-4 py-3">
            <summary className="cursor-pointer list-none text-[14px] font-medium text-[#222] [&::-webkit-details-marker]:hidden">
              How this check was done
              <span className="font-normal text-[#6a6a6a]">
                {" "}
                · {count(check.events, "search", "search", "searches")}, {count(check.events, "read", "page", "pages")} read
              </span>
              <span className="float-right text-[#6a6a6a] transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="mt-3">
              <Activity events={check.events} />
            </div>
          </details>
        )}
      </div>

      <footer className="border-t border-[#ebebeb] px-6 py-4 text-[13px] leading-[1.4] text-[#6a6a6a]">
        Public information only: no criminal, court or credit records. A check helps you decide; it isn&apos;t a
        guarantee.
        {guestIsMember && requestId && ` ${first} can see this report.`} Deleted on {formatDate(check.expiresAt)}.
      </footer>
    </section>
  );
}

function ProfileCard({
  profile,
  fallbackName,
  running,
}: {
  profile: CheckJson["profile"];
  fallbackName: string;
  running: boolean;
}) {
  const hasAnything = profile.headline || profile.location || profile.occupation || profile.profiles?.length;
  if (!hasAnything && !running) return null;
  const identity = profile.identity ? IDENTITY[profile.identity] : null;
  const chips = [profile.location, profile.occupation, profile.languages?.join(", ")].filter(Boolean) as string[];

  return (
    <div className="rounded-[14px] bg-[#f7f7f7] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[20px] font-semibold tracking-[-0.18px]">{profile.name ?? fallbackName}</p>
          {profile.headline ? (
            <p key={profile.headline} className="abnb-in mt-1 text-[15px] text-[#3f3f3f]">
              {profile.headline}
            </p>
          ) : (
            <div className="mt-2 h-4 w-64 max-w-full animate-pulse rounded bg-[#ebebeb]" />
          )}
        </div>
        {identity && (
          <div className="abnb-in shrink-0 text-right" title="How sure the check is that everything here is the same person">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6a6a6a]">Identity</p>
            <div className="mt-1 flex justify-end gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-1.5 w-5 rounded-full ${i < identity.bars ? "bg-[#222]" : "bg-[#ddd]"}`} />
              ))}
            </div>
            <p className="mt-1 text-[13px] font-medium">{identity.label}</p>
          </div>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c} className="abnb-in rounded-full bg-white px-3 py-1 text-[13px] text-[#222] ring-1 ring-[#ddd]">
              {c}
            </span>
          ))}
        </div>
      )}

      {profile.profiles && profile.profiles.length > 0 && (
        <ul className="mt-4 space-y-2">
          {profile.profiles.map((p) => (
            <li key={p.url} className="abnb-in flex items-baseline gap-2 text-[14px]">
              <a href={p.url} target="_blank" rel="noreferrer" className="shrink-0 font-semibold underline underline-offset-2">
                {p.platform}
              </a>
              {p.note && <span className="min-w-0 text-[#6a6a6a]">{p.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {running && !profile.profiles?.length && (
        <p className="mt-4 text-[13px] text-[#6a6a6a]">Building their profile from what I find…</p>
      )}
    </div>
  );
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className="abnb-in py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[15px] font-medium leading-snug">{f.title}</p>
        <span
          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            f.confidence === "high" ? "bg-[#222] text-white" : f.confidence === "medium" ? "bg-[#f2f2f2]" : "text-[#6a6a6a] ring-1 ring-[#ddd]"
          }`}
          title="How sure the check is about this"
        >
          {f.confidence === "high" ? "Confirmed" : f.confidence === "medium" ? "Likely" : "Possible"}
        </span>
      </div>
      {f.detail && <p className="mt-1 text-[14px] leading-[1.5] text-[#3f3f3f]">{f.detail}</p>}
      <p className="mt-1.5 text-[13px] text-[#6a6a6a]">
        {f.sourceUrl ? (
          <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-[#222]">
            {f.sourceTitle || hostname(f.sourceUrl)}
          </a>
        ) : (
          (f.sourceTitle ?? "From the request")
        )}
      </p>
    </li>
  );
}

const KIND_ICON: Record<string, string> = {
  search: "M10.5 18a7.5 7.5 0 1 1 5.3-2.2L21 21",
  read: "M6 3h9l4 4v14H6zM14 3v5h5",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  finding: "M5 12l4 4 10-10",
  note: "M12 8v5m0 3v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  error: "M12 8v5m0 3v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  done: "M5 12l4 4 10-10",
};

function Activity({ events, live = false }: { events: CheckEvent[]; live?: boolean }) {
  const shown = live ? events.slice(-7) : events;
  return (
    <ol className="space-y-2" aria-live={live ? "polite" : undefined}>
      {shown.map((e, i) => {
        const current = live && i === shown.length - 1;
        return (
          <li key={e.id} className="abnb-in flex items-start gap-3 text-[14px]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`mt-0.5 size-4 shrink-0 ${
                e.kind === "error" ? "text-[#c13515]" : e.kind === "finding" ? "text-[#222]" : "text-[#929292]"
              }`}
              aria-hidden
            >
              <path d={KIND_ICON[e.kind] ?? KIND_ICON.note} />
            </svg>
            <span className={`min-w-0 ${current ? "text-[#222]" : "text-[#6a6a6a]"} ${e.kind === "finding" ? "font-medium text-[#222]" : ""}`}>
              {e.url && e.kind !== "finding" ? (
                <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {e.message}
                </a>
              ) : (
                e.message
              )}
              {current && <span className="ml-1 inline-block animate-pulse">…</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
