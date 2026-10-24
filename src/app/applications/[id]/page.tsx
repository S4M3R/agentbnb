import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ApplicationError, CLOSED, CONFIRMED, getApplication } from "@/lib/applications";
import { currentUser } from "@/lib/session";
import {
  markSentManually,
  respondToRequest,
  scheduleStay,
  sendApplications,
  withdrawApplications,
} from "../actions";
import { STATUS, TRANSIENT, TYPE_LABEL, formatRange, hostEventText, hostStatus, statusClass, timeAgo } from "../status";
import { ActionButton, CopyButton, KickRuns, LiveRefresh, MarkRead, ReplyBox, ScheduleForm } from "../ui";
import { NeedsUserBlock } from "../../me/keychain/forms";
import { latestAsk } from "@/lib/access";
import { PageShell } from "@/components/shell/page-shell";
import { MetaLine, SiteName } from "@/components/ui/site-name";

export const metadata: Metadata = { title: "Application" };

export default function ApplicationPage({ params }: PageProps<"/applications/[id]">) {
  return (
    <PageShell back={{ href: "/applications", label: "Applications" }}>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-[14px] bg-surface-soft" />}>
        <Application params={params} />
      </Suspense>
    </PageShell>
  );
}

async function Application({ params }: { params: PageProps<"/applications/[id]">["params"] }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user || !z.uuid().safeParse(id).success) notFound();
  const app = await getApplication(id, user.id).catch((err) => {
    if (err instanceof ApplicationError) notFound();
    throw err;
  });

  const isGuest = app.role === "guest";
  const dates = formatRange(app.startDate, app.endDate);
  const closed = CLOSED.includes(app.status);
  const overlapNudge = app.timeline.findLast((e) => e.kind === "nudge" && e.data.kind === "overlap");
  const stillOverlapping = app.overlapping.filter((o) => o.status !== "cancelled");
  const pill = isGuest ? { label: STATUS[app.status].label, cls: statusClass(app.status) } : hostStatus(app.status);
  // The host sees their side of the story: no drafts, no agent chatter, status in their words.
  const timeline = isGuest
    ? app.timeline
    : app.timeline.flatMap((e) => {
        if (e.kind === "message") return [e];
        if (e.kind !== "status") return [];
        const body = hostEventText(e.data.to as typeof app.status | undefined, e.body, app.guest?.name ?? "The guest");
        return body ? [{ ...e, body }] : [];
      });

  return (
    <div className="flex flex-col gap-6 pb-10">
      <LiveRefresh everyMs={TRANSIENT.includes(app.status) ? 3000 : 15000} />
      <MarkRead applicationId={app.id} />
      {isGuest && app.channel === "external_auto" && !closed && <KickRuns ids={[app.id]} state={app.status} />}

      <section className="flex gap-4">
        <div className="size-24 shrink-0 overflow-hidden rounded-[14px] bg-surface-strong sm:size-28">
          {app.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
            <img src={app.photo} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={`inline-flex h-[22px] items-center self-start rounded-full px-2 text-[11px] font-bold ${pill.cls}`}
          >
            {pill.label}
          </span>
          <h1 className="text-[22px] font-semibold leading-snug tracking-[-0.02em]">{app.listing.title}</h1>
          <MetaLine
            className="text-sm text-muted"
            parts={[
              TYPE_LABEL[app.listing.type] ?? app.listing.type,
              <SiteName key="s" site={app.source.id}>{app.source.name}</SiteName>,
              dates,
              app.arrival && `arriving ${app.arrival}`,
            ]}
          />
          {app.listing.externalUrl && (
            <a href={app.listing.externalUrl} target="_blank" rel="noreferrer" className="self-start text-sm font-semibold underline underline-offset-2 hover:text-body">
              <SiteName site={app.source.id}>View on {app.source.name} ↗</SiteName>
            </a>
          )}
        </div>
      </section>

      {isGuest && app.statusMessage && app.status !== "needs_user" && (
        <p className="rounded-[14px] bg-surface-soft px-4 py-3 text-sm leading-relaxed text-body">{app.statusMessage}</p>
      )}

      {/* Waiting for a login or email: the secure form; otherwise the live browser or Continue. */}
      {isGuest && app.status === "needs_user" && (
        <NeedsUserBlock app={app} ask={latestAsk(app.status, app.timeline)} />
      )}

      {isGuest && overlapNudge && stillOverlapping.length > 0 && CONFIRMED.includes(app.status) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-hairline px-4 py-3 text-sm leading-relaxed">
          <div>
            You have {stillOverlapping.length} other application{stillOverlapping.length === 1 ? "" : "s"} for these dates:{" "}
            {stillOverlapping.map((o) => o.listing.title).join(", ")}.
          </div>
          <ActionButton action={withdrawApplications.bind(null, stillOverlapping.map((o) => o.id))}>
            Withdraw {stillOverlapping.length === 1 ? "it" : "them"}
          </ActionButton>
        </div>
      )}

      <Actions app={app} />

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">{isGuest ? "Activity" : `Request from ${app.guest?.name ?? "a guest"}`}</h2>
        {!isGuest && app.guest && (
          <div className="rounded-[14px] border border-hairline p-6 text-sm">
            <div className="text-base font-semibold">{app.guest.name}</div>
            <div className="text-muted">
              {[app.guest.homeCity && `from ${app.guest.homeCity}`, app.guest.languages.length > 0 && app.guest.languages.join(", ")]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {app.guest.bio && <p className="mt-2 leading-relaxed text-body">{app.guest.bio}</p>}
          </div>
        )}
        {app.intro && (
          <Bubble side={isGuest ? "right" : "left"} label={isGuest ? "Your application" : "Their intro"}>
            {app.intro}
          </Bubble>
        )}
        <ol className="flex flex-col gap-3">
          {timeline.map((e) =>
            e.kind === "message" ? (
              <li key={e.id}>
                <Bubble
                  side={(e.actor === "guest") === isGuest ? "right" : "left"}
                  label={`${e.actor === "guest" ? (isGuest ? "You" : app.guest?.name) : isGuest ? "Host" : "You"} · ${timeAgo(e.createdAt)}${
                    e.data.delivery === "pending" ? " · sending…" : ""
                  }`}
                >
                  {e.body}
                </Bubble>
              </li>
            ) : (
              e.body && (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                  <span className={e.kind === "nudge" ? "font-semibold" : "text-body"}>
                    {e.body}
                    <span className="font-normal text-muted"> · {timeAgo(e.createdAt)}</span>
                  </span>
                </li>
              )
            ),
          )}
        </ol>
        {!closed && app.status !== "draft" && (
          <ReplyBox
            applicationId={app.id}
            viaBrowser={isGuest && app.channel === "external_auto"}
            placeholder={isGuest ? (app.channel === "internal" ? "Message the host…" : `Reply to the host on ${app.source.name}…`) : `Reply to ${app.guest?.name ?? "the guest"}…`}
          />
        )}
      </section>
    </div>
  );
}

type App = Awaited<ReturnType<typeof getApplication>>;

function Actions({ app }: { app: App }) {
  if (app.role === "host") {
    if (app.status === "sent")
      return (
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="primary" action={respondToRequest.bind(null, app.id, "accept", undefined)}>
            Accept
          </ActionButton>
          <ActionButton action={respondToRequest.bind(null, app.id, "decline", undefined)}>Decline</ActionButton>
        </div>
      );
    if (app.status === "accepted") return <ScheduleForm action={scheduleStay.bind(null, app.id)} />;
    return null;
  }

  const withdraw = (
    <ActionButton variant="text" action={withdrawApplications.bind(null, [app.id])} confirm="Withdraw this application?">
      Withdraw
    </ActionButton>
  );
  switch (app.status) {
    case "draft":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton variant="primary" action={sendApplications.bind(null, [app.id])}>
            Send application
          </ActionButton>
          <span className="text-sm text-muted">Want changes? Tell the agent in chat.</span>
          {withdraw}
        </div>
      );
    case "failed":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton variant="primary" action={sendApplications.bind(null, [app.id])}>
            Try again
          </ActionButton>
          {app.listing.externalUrl && app.intro && <CopyButton text={app.intro} label="Copy message" />}
          {app.listing.externalUrl && (
            <ActionButton action={markSentManually.bind(null, app.id)}>I applied myself</ActionButton>
          )}
        </div>
      );
    case "needs_user":
      return app.liveViewUrl ? null : (
        <div className="flex flex-wrap items-center gap-3">
          {app.listing.externalUrl && <ActionButton action={markSentManually.bind(null, app.id)}>I applied myself</ActionButton>}
          {withdraw}
        </div>
      );
    case "accepted":
      return (
        <div className="flex flex-col gap-2">
          <div className="text-base font-semibold">When will you arrive?</div>
          <ScheduleForm action={scheduleStay.bind(null, app.id)} />
        </div>
      );
    case "queued":
    case "sending":
    case "sent":
    case "scheduled":
      return <div>{withdraw}</div>;
    default:
      return null;
  }
}

function Bubble({ side, label, children }: { side: "left" | "right"; label?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 ${side === "right" ? "items-end" : "items-start"}`}>
      {label && <span className="px-1 text-xs text-muted">{label}</span>}
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          side === "right" ? "bg-surface-strong" : "border border-hairline bg-canvas"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
