"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import type { ApplicationCard } from "@/lib/agent/apply-tools";
import type { ApplicationStatus } from "@/lib/applications";
import { sendApplications } from "./applications/actions";
import { STATUS, formatRange, statusClass } from "./applications/status";
import { kickRuns } from "./applications/ui";
import { MetaLine, SiteName } from "@/components/ui/site-name";

// Application drafts and their live status, inside the chat.

type Live = Record<string, { status: ApplicationStatus; statusMessage: string | null }>;

/** Fired when an application changes outside a card (e.g. sent from the side panel), so cards reload. */
export const APPLICATIONS_CHANGED = "agentbnb:applications-changed";

const SETTLED: ApplicationStatus[] = ["sent", "accepted", "declined", "scheduled", "cancelled", "failed"];

/**
 * The cards' live status. Loads once when the cards appear (a chat restored from history holds the
 * status from when it was drafted), again when the tab comes back, and every 3s while any card is still
 * moving (queued, sending, needs you).
 */
function useLiveStatus(cards: ApplicationCard[]) {
  const [live, setLive] = useState<Live>({});
  const ids = cards.map((c) => c.id).join(",");
  const moving = cards.some((c) => {
    const s = live[c.id]?.status ?? c.status;
    return !SETTLED.includes(s) && s !== "draft";
  });
  const [poke, setPoke] = useState(0);

  useEffect(() => {
    if (!ids) return;
    let stop = false;
    async function load() {
      const res = await fetch(`/api/applications?ids=${ids}`).catch(() => null);
      if (!res?.ok || stop) return;
      const body: { applications: { id: string; status: ApplicationStatus; statusMessage: string | null }[] } = await res.json();
      setLive(Object.fromEntries(body.applications.map((a) => [a.id, a])));
    }
    load();
    const t = moving ? setInterval(load, 3000) : undefined;
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ids, moving, poke]);

  useEffect(() => {
    const onChange = () => setPoke((n) => n + 1);
    window.addEventListener(APPLICATIONS_CHANGED, onChange);
    return () => window.removeEventListener(APPLICATIONS_CHANGED, onChange);
  }, []);

  return live;
}

export function ApplicationCards({
  cards,
  problems,
  openId,
  onOpen,
}: {
  cards: ApplicationCard[];
  problems?: { error: string }[];
  /** The application showing in the side panel, outlined. */
  openId?: string | null;
  /** Open an application in the side panel instead of going to its page. */
  onOpen?: (id: string) => void;
}) {
  const live = useLiveStatus(cards);
  // Start runs only for applications the server says are still queued, never from a restored snapshot.
  const queued = cards.filter((c) => live[c.id]?.status === "queued").map((c) => c.id).join(",");
  useEffect(() => {
    if (queued) kickRuns(queued.split(","));
  }, [queued]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Send only once the server confirms it's still a draft: a restored chat's snapshot may be long sent.
  const drafts = cards.filter((c) => live[c.id]?.status === "draft");

  function send(ids: string[]) {
    setError(null);
    start(async () => {
      const r = await sendApplications(ids);
      if (!r.ok) setError(r.error);
      else kickRuns(ids); // external ones start in the browser now
      window.dispatchEvent(new Event(APPLICATIONS_CHANGED));
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {cards.map((c) => (
        <Card
          key={c.id}
          card={c}
          live={live[c.id]}
          onSend={() => send([c.id])}
          sending={pending}
          selected={openId === c.id}
          onOpen={onOpen && (() => onOpen(c.id))}
        />
      ))}
      {problems?.map((p, i) => (
        <div key={i} className="text-sm text-muted">
          {p.error}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {drafts.length > 1 && (
          <Button size="sm" disabled={pending} onClick={() => send(drafts.map((d) => d.id))}>
            Send all {drafts.length}
          </Button>
        )}
        {error && <span className="text-sm text-error">{error}</span>}
      </div>
    </div>
  );
}

function Card({
  card: c,
  live,
  onSend,
  sending,
  selected = false,
  onOpen,
}: {
  card: ApplicationCard;
  live?: Live[string];
  onSend: () => void;
  sending: boolean;
  /** Showing in the side panel. */
  selected?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = live?.status ?? c.status;
  const message = live ? live.statusMessage : c.statusMessage;
  const dates = formatRange(c.startDate, c.endDate);
  return (
    <article
      className={`flex gap-3 rounded-card border bg-canvas p-3 text-sm transition-colors sm:gap-4 ${selected ? "border-ink" : "border-hairline"}`}
    >
      <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-surface-strong sm:size-[72px]">
        {c.photo && (
          // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
          <img src={c.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate text-[15px] font-semibold text-ink">{c.title}</div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
            {STATUS[status].label}
          </span>
        </div>
        <MetaLine className="text-muted" parts={[<SiteName key="s" site={c.sourceId}>{c.source}</SiteName>, dates]} />
        {status !== "draft" && message && <div className="text-body">{message}</div>}
        {c.intro && status === "draft" && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={`text-left leading-relaxed text-body ${open ? "whitespace-pre-wrap" : "line-clamp-2"}`}
          >
            {c.intro}
          </button>
        )}
        <div className="flex items-center gap-3 pt-1.5">
          {status === "draft" && live && (
            <button
              type="button"
              disabled={sending}
              onClick={onSend}
              className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-[13px] font-semibold text-white transition-colors hover:bg-body disabled:opacity-40"
            >
              Send
            </button>
          )}
          {status === "needs_user" ? (
            <Link
              href={c.url}
              onClick={(e) => {
                // In the chat, the live browser opens in the side panel; elsewhere, on the application's page.
                if (!onOpen) return;
                e.preventDefault();
                onOpen();
              }}
              aria-expanded={onOpen ? selected : undefined}
              className="inline-flex h-9 items-center rounded-lg bg-rausch px-4 text-[13px] font-semibold text-white transition-colors hover:bg-rausch-active"
            >
              Open the browser
            </Link>
          ) : (
            <Link
              href={c.url}
              onClick={(e) => {
                if (!onOpen) return;
                e.preventDefault();
                onOpen();
              }}
              aria-expanded={onOpen ? selected : undefined}
              className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-ink underline-offset-2 hover:underline"
            >
              {status === "draft" ? "Review" : "Track it"}
              <ChevronRightIcon size={14} strokeWidth={2.4} />
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
    <Link href="/applications" className="relative text-sm font-medium text-muted hover:text-ink">
      Applications
      {unread > 0 && (
        <span className="absolute -right-3 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-rausch px-1 text-[10px] font-semibold leading-4 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
