"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { ApplicationCard } from "@/lib/agent/apply-tools";
import type { ApplicationStatus } from "@/lib/applications";
import { sendApplications } from "./applications/actions";
import { STATUS, formatRange, statusClass } from "./applications/status";
import { kickRuns } from "./applications/ui";

// Application drafts and their live status, inside the chat.

type Live = Record<string, { status: ApplicationStatus; statusMessage: string | null }>;

const SETTLED: ApplicationStatus[] = ["sent", "accepted", "declined", "scheduled", "cancelled", "failed"];

/** Poll the cards' status while any of them is still moving (queued, sending, needs you). */
function useLiveStatus(cards: ApplicationCard[]) {
  const [live, setLive] = useState<Live>({});
  const ids = cards.map((c) => c.id).join(",");
  const moving = cards.some((c) => !SETTLED.includes(live[c.id]?.status ?? c.status) && (live[c.id]?.status ?? c.status) !== "draft");
  const [poke, setPoke] = useState(0);

  useEffect(() => {
    if (!ids || (!moving && poke === 0)) return;
    let stop = false;
    async function load() {
      const res = await fetch(`/api/applications?ids=${ids}`).catch(() => null);
      if (!res?.ok || stop) return;
      const body: { applications: { id: string; status: ApplicationStatus; statusMessage: string | null }[] } = await res.json();
      setLive(Object.fromEntries(body.applications.map((a) => [a.id, a])));
    }
    load();
    const t = moving ? setInterval(load, 3000) : undefined;
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [ids, moving, poke]);

  return { live, refresh: () => setPoke((n) => n + 1) };
}

export function ApplicationCards({ cards, problems }: { cards: ApplicationCard[]; problems?: { error: string }[] }) {
  const { live, refresh } = useLiveStatus(cards);
  const queued = cards.filter((c) => c.status === "queued").map((c) => c.id).join(",");
  useEffect(() => {
    if (queued) kickRuns(queued.split(","));
  }, [queued]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const status = (c: ApplicationCard) => live[c.id]?.status ?? c.status;
  const drafts = cards.filter((c) => status(c) === "draft");

  function send(ids: string[]) {
    setError(null);
    start(async () => {
      const r = await sendApplications(ids);
      if (!r.ok) setError(r.error);
      else kickRuns(ids); // external ones start in the browser now
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {cards.map((c) => (
        <Card key={c.id} card={c} live={live[c.id]} onSend={() => send([c.id])} sending={pending} />
      ))}
      {problems?.map((p, i) => (
        <div key={i} className="text-sm text-zinc-500">
          {p.error}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {drafts.length > 1 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => send(drafts.map((d) => d.id))}
            className="rounded-lg bg-[#ff385c] px-4 py-2 text-sm font-medium text-white hover:bg-[#e00b41] disabled:bg-[#ffd1da]"
          >
            Send all {drafts.length}
          </button>
        )}
        {error && <span className="text-sm text-[#c13515]">{error}</span>}
      </div>
    </div>
  );
}

function Card({
  card: c,
  live,
  onSend,
  sending,
}: {
  card: ApplicationCard;
  live?: Live[string];
  onSend: () => void;
  sending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const status = live?.status ?? c.status;
  const message = live ? live.statusMessage : c.statusMessage;
  const dates = formatRange(c.startDate, c.endDate);
  return (
    <article className="flex gap-3 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
        {c.photo && (
          // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
          <img src={c.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate font-medium">{c.title}</div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(status)}`}>
            {STATUS[status].label}
          </span>
        </div>
        <div className="text-zinc-500">{[c.source, dates].filter(Boolean).join(" · ")}</div>
        {status !== "draft" && message && <div className="text-zinc-600 dark:text-zinc-400">{message}</div>}
        {c.intro && status === "draft" && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={`text-left text-zinc-600 dark:text-zinc-400 ${open ? "whitespace-pre-wrap" : "line-clamp-2"}`}
          >
            {c.intro}
          </button>
        )}
        <div className="flex items-center gap-3 pt-1">
          {status === "draft" && (
            <button
              type="button"
              disabled={sending}
              onClick={onSend}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
            >
              Send
            </button>
          )}
          {status === "needs_user" ? (
            <Link href={c.url} className="rounded-lg bg-[#ff385c] px-3 py-1.5 text-xs font-medium text-white">
              Open the browser
            </Link>
          ) : (
            <Link href={c.url} className="text-xs text-zinc-500 hover:text-foreground">
              {status === "draft" ? "Review" : "Track it"} →
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

/** Header link to the Applications tab, with a dot for unread updates. */
export function ApplicationsLink() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let stop = false;
    async function load() {
      const res = await fetch("/api/applications").catch(() => null);
      if (res?.ok && !stop) setUnread((await res.json()).unread ?? 0);
    }
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return (
    <Link href="/applications" className="relative text-sm text-zinc-500 hover:text-foreground">
      Applications
      {unread > 0 && (
        <span className="absolute -right-3 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-[#ff385c] px-1 text-[10px] font-semibold leading-4 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
