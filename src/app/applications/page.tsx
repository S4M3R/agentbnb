import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CLOSED, CONFIRMED, IN_PROGRESS, listForGuest, listForHost, type ApplicationSummary } from "@/lib/applications";
import { currentUser } from "@/lib/session";
import { STATUS, TRANSIENT, TYPE_LABEL, formatRange, statusClass, timeAgo } from "./status";
import { KickRuns, LiveRefresh, NotifySetup } from "./ui";
import { PageHeading, PageShell } from "@/components/shell/page-shell";
import { MetaLine, SiteName } from "@/components/ui/site-name";
import { Couchbot } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Applications",
  description: "Every place you've applied to, and where each one stands.",
};

const TABS = [
  { id: "active", label: "In progress", statuses: IN_PROGRESS },
  { id: "confirmed", label: "Confirmed", statuses: CONFIRMED },
  { id: "closed", label: "Closed", statuses: CLOSED },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  return (
    <PageShell>
      <PageHeading title="Applications" lead="Every place you've applied to, and where each one stands." />
      <Suspense fallback={<ListSkeleton />}>
        <Applications searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Applications({ searchParams }: { searchParams: PageProps<"/applications">["searchParams"] }) {
  const { tab: rawTab } = await searchParams;
  const user = await currentUser();
  if (!user) return <Empty tab="active" />;

  const [mine, requests, [profile]] = await Promise.all([
    listForGuest(user.id),
    listForHost(user.id),
    db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, user.id)),
  ]);
  const counts: Record<TabId, number> = {
    active: mine.filter((a) => IN_PROGRESS.includes(a.status)).length,
    confirmed: mine.filter((a) => CONFIRMED.includes(a.status)).length,
    closed: mine.filter((a) => CLOSED.includes(a.status)).length,
  };
  // Default to the first tab with something in it.
  const tab = TABS.find((t) => t.id === rawTab) ?? TABS.find((t) => counts[t.id] > 0) ?? TABS[0];
  const rows = mine.filter((a) => (tab.statuses as readonly string[]).includes(a.status));
  const busy = mine.some((a) => TRANSIENT.includes(a.status));
  const newRequests = requests.filter((a) => a.status === "sent").length;

  return (
    <div className="flex flex-col gap-4 pb-10">
      <LiveRefresh everyMs={busy ? 4000 : 20000} />
      {/* Opening the tab re-checks external sites for news (the server skips recently checked ones). */}
      <KickRuns
        ids={mine
          .filter((a) => a.channel === "external_auto" && (a.status === "queued" || CONFIRMED.includes(a.status) || a.status === "sent"))
          .slice(0, 10)
          .map((a) => a.id)}
      />
      <nav className="flex gap-6 overflow-x-auto border-b border-hairline-soft text-[15px] no-scrollbar">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/applications?tab=${t.id}`}
            aria-current={t.id === tab.id ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 pb-3 font-semibold transition-colors ${
              t.id === tab.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {counts[t.id] > 0 && <span className="ml-1.5 font-medium text-muted tabular-nums">{counts[t.id]}</span>}
          </Link>
        ))}
        {requests.length > 0 && (
          <Link href="/requests" className="ml-auto shrink-0 pb-3 font-medium text-muted transition-colors hover:text-ink">
            Requests for your place
            {newRequests > 0 && <span className="ml-1.5 font-semibold text-rausch tabular-nums">{newRequests}</span>} →
          </Link>
        )}
      </nav>
      {mine.length > 0 && <NotifySetup email={profile?.email ?? null} />}
      {rows.length === 0 ? (
        <Empty tab={tab.id} />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline-soft">
          {rows.map((a) => (
            <Row key={a.id} app={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ app: a }: { app: ApplicationSummary }) {
  const dates = formatRange(a.startDate, a.endDate);
  return (
    <li>
      <Link
        href={`/applications/${a.id}`}
        className="-mx-3 flex gap-4 rounded-[14px] px-3 py-4 transition-colors hover:bg-surface-soft"
      >
        <div className="size-20 shrink-0 overflow-hidden rounded-[14px] bg-surface-strong">
          {a.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
            <img src={a.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="truncate text-base font-semibold">{a.listing.title}</div>
            <span
              className={`inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11px] font-bold ${statusClass(a.status)}`}
            >
              {STATUS[a.status].label}
            </span>
          </div>
          <MetaLine
            className="text-muted"
            parts={[
              TYPE_LABEL[a.listing.type] ?? a.listing.type,
              <SiteName key="s" site={a.source.id}>{a.source.name}</SiteName>,
              dates,
            ]}
          />
          <div className="line-clamp-1 text-body">
            {a.lastEvent || a.statusMessage}
            <span className="text-muted"> · {timeAgo(a.updatedAt)}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

function Empty({ tab }: { tab: TabId }) {
  const copy: Record<TabId, string> = {
    active: "Nothing in progress. Tell me where you're headed and tap Apply on a place you like.",
    confirmed: "No confirmed stays yet. Accepted applications show up here.",
    closed: "Nothing here.",
  };
  return (
    <div className="flex flex-col items-center gap-4 rounded-[14px] border border-dashed border-hairline px-6 py-14 text-center">
      <Couchbot size={72} mood="sleepy" animated />
      <p className="max-w-md text-[15px] leading-relaxed text-muted">{copy[tab]}</p>
      {tab === "active" && (
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-lg bg-rausch px-6 font-medium text-white transition-colors hover:bg-rausch-active"
        >
          Find a place
        </Link>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 border-b border-hairline-soft" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 py-4">
          <div className="size-20 animate-pulse rounded-[14px] bg-surface-strong" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-surface-strong" />
            <div className="h-3 w-1/3 animate-pulse rounded-full bg-surface-strong" />
          </div>
        </div>
      ))}
    </div>
  );
}
