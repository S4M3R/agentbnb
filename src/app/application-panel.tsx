"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { PhotoMosaic } from "@/components/stays/stay-panel";
import { Button, ButtonLink } from "@/components/ui/button";
import { CloseIcon, ExternalIcon } from "@/components/ui/icons";
import { MetaLine, SiteIcon, SiteName } from "@/components/ui/site-name";
import type { ApplicationStatus } from "@/lib/applications";
import type { ApplicationDetail } from "./api/applications/[id]/route";
import { APPLICATIONS_CHANGED } from "./application-cards";
import { sendApplications } from "./applications/actions";
import { STATUS, TRANSIENT, TYPE_LABEL, formatRange, statusClass, timeAgo } from "./applications/status";
import { kickRuns, MarkRead, ReplyBox, WatchBrowser } from "./applications/ui";
import { NeedsUserBlock } from "./me/keychain/forms";

// One of the guest's applications in the chat's side panel, like a listing: the place, what the
// agent wrote for them, and the conversation with the host so far. The full page has the rest.

const CLOSED: ApplicationStatus[] = ["declined", "cancelled", "failed"];

/** The application, re-fetched every few seconds while something is moving. */
function useApplication(id: string) {
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [version, setVersion] = useState(0);
  const busy = app ? TRANSIENT.includes(app.status) || app.status === "needs_user" : false;

  useEffect(() => {
    let stale = false;
    async function load() {
      const res = await fetch(`/api/applications/${id}`).catch(() => null);
      if (stale) return;
      if (res?.status === 404) setMissing(true);
      else if (res?.ok) setApp(await res.json());
    }
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), busy ? 3000 : 15000);
    return () => {
      stale = true;
      clearInterval(t);
    };
  }, [id, busy, version]);

  // Sent from a chat card, or a reply posted here: load it now rather than at the next tick.
  useEffect(() => {
    const reload = () => setVersion((v) => v + 1);
    window.addEventListener(APPLICATIONS_CHANGED, reload);
    return () => window.removeEventListener(APPLICATIONS_CHANGED, reload);
  }, []);

  return { app, missing, reload: () => setVersion((v) => v + 1) };
}

export function ApplicationPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { app, missing, reload } = useApplication(id);
  const [sending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function send() {
    setError(null);
    start(async () => {
      const r = await sendApplications([id]);
      if (!r.ok) return setError(r.error);
      kickRuns([id]);
      window.dispatchEvent(new Event(APPLICATIONS_CHANGED)); // the chat cards, and this panel
    });
  }

  const closed = app ? CLOSED.includes(app.status) : false;
  const dates = app && formatRange(app.startDate, app.endDate);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <MarkRead applicationId={id} />
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 pl-6 pr-3">
        <h2 className="truncate text-[15px] font-semibold">
          {app ? ["Your application", app.source.name].join(" · ") : "Your application"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-strong"
        >
          <CloseIcon size={18} strokeWidth={2.2} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-7">
        {!app ? (
          missing ? (
            <p className="text-sm text-muted">This application is gone.</p>
          ) : (
            <div className="h-64 animate-pulse rounded-2xl bg-surface-soft sm:h-[300px]" />
          )
        ) : (
          <>
            {/* When the agent needs the guest in the browser, that's the first thing they see. */}
            {/* Waiting for a login or email: the secure form; otherwise the live browser or Continue. */}
            {app.status === "needs_user" && (
              <div className="mb-6">
                <NeedsUserBlock app={app} ask={app.ask} />
              </div>
            )}
            {/* While the agent works on its own, watch its browser here (or see it getting ready). */}
            {app.status !== "needs_user" && (app.liveViewUrl || app.status === "queued" || app.status === "sending") && (
              <div className="mb-6">
                <WatchBrowser url={app.liveViewUrl} site={app.source.name} message={app.statusMessage} />
              </div>
            )}
            <PhotoMosaic photos={app.photos} title={app.listing.title} />

            <span
              className={`mt-[22px] inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-bold ${statusClass(app.status)}`}
            >
              {STATUS[app.status].label}
            </span>
            <h3 className="mt-2 text-[26px] font-bold leading-8 tracking-[-0.025em]">{app.listing.title}</h3>
            <MetaLine
              className="mt-1.5 text-[15px] text-body"
              parts={[
                TYPE_LABEL[app.listing.type] ?? app.listing.type,
                <SiteName key="s" site={app.source.id}>
                  {app.source.name}
                </SiteName>,
                dates,
                app.arrival && `arriving ${app.arrival}`,
              ]}
            />

            {app.statusMessage && app.status !== "draft" && app.status !== "needs_user" && !(app.liveViewUrl || app.status === "queued" || app.status === "sending") && (
              <p className="mt-5 rounded-[14px] bg-surface-soft px-4 py-3 text-sm leading-relaxed text-body">
                {app.statusMessage}
              </p>
            )}

            {app.intro && (
              <Section title={app.status === "draft" ? "What the host will read" : "Your application"}>
                <p className="whitespace-pre-wrap rounded-2xl bg-surface-strong px-4 py-3 text-[15px] leading-6 text-ink">
                  {app.intro}
                </p>
                {app.status === "draft" && (
                  <p className="mt-2 text-sm text-muted">Want changes? Tell your agent in the chat.</p>
                )}
              </Section>
            )}

            {app.status !== "draft" && (
              <Section title="Activity">
                <Timeline app={app} />
                {!closed && (
                  <div className="mt-4">
                    <ReplyBox
                      applicationId={app.id}
                      viaBrowser={app.channel === "external_auto"}
                      placeholder={app.channel === "internal" ? "Message the host…" : `Reply to the host on ${app.source.name}…`}
                      onSent={reload}
                    />
                  </div>
                )}
              </Section>
            )}
          </>
        )}
      </div>

      {app && (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline-soft px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          {app.listing.url ? (
            <ButtonLink href={app.listing.url} variant="secondary" size="sm">
              <SiteIcon site={app.source.id} />
              View on {app.source.name}
              <ExternalIcon size={16} />
            </ButtonLink>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {error && <span className="text-sm text-error">{error}</span>}
            {app.status === "draft" ? (
              <Button size="sm" disabled={sending} onClick={send}>
                {sending ? "Sending…" : "Send application"}
              </Button>
            ) : (
              <ButtonLink href={`/applications/${app.id}`} variant="ghost" size="sm">
                Open full page
              </ButtonLink>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function Timeline({ app }: { app: ApplicationDetail }) {
  const items = app.timeline.filter((e) => e.body);
  if (!items.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((e) =>
        e.kind === "message" ? (
          <li key={e.id} className={`flex flex-col gap-1 ${e.actor === "guest" ? "items-end" : "items-start"}`}>
            <span className="px-1 text-xs text-muted">
              {e.actor === "guest" ? "You" : "Host"} · {timeAgo(e.createdAt)}
              {e.pending && " · sending…"}
            </span>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                e.actor === "guest" ? "bg-surface-strong" : "border border-hairline bg-canvas"
              }`}
            >
              {e.body}
            </div>
          </li>
        ) : (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
            <span className={e.kind === "nudge" ? "font-semibold" : "text-body"}>
              {e.body}
              <span className="font-normal text-muted"> · {timeAgo(e.createdAt)}</span>
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h4 className="mb-3.5 text-lg font-semibold">{title}</h4>
      {children}
    </section>
  );
}
