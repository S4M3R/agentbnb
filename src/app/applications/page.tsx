import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CLOSED, CONFIRMED, IN_PROGRESS, listForGuest, listForHost, type ApplicationSummary } from "@/lib/applications";
import { currentUser } from "@/lib/session";
import { STATUS, TRANSIENT, TYPE_LABEL, formatRange, statusClass, timeAgo } from "./status";
import { KickRuns, LiveRefresh, NotifySetup } from "./ui";

export const metadata: Metadata = {
  title: "Applications · AgentBnB",
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
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          AgentBnB
        </Link>
        <Link href="/" className="text-sm text-zinc-500 hover:text-foreground">
          Back to chat
        </Link>
      </header>
      <h1 className="pb-4 text-2xl font-semibold tracking-tight">Applications</h1>
      <Suspense fallback={<ListSkeleton />}>
        <Applications searchParams={searchParams} />
      </Suspense>
    </div>
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
      <nav className="flex gap-6 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/applications?tab=${t.id}`}
            className={`-mb-px border-b-2 pb-3 font-medium ${
              t.id === tab.id ? "border-foreground text-foreground" : "border-transparent text-zinc-500 hover:text-foreground"
            }`}
          >
            {t.label}
            {counts[t.id] > 0 && <span className="ml-1.5 text-zinc-400">{counts[t.id]}</span>}
          </Link>
        ))}
        {requests.length > 0 && (
          <Link href="/requests" className="ml-auto pb-3 font-medium text-zinc-500 hover:text-foreground">
            Requests for your place{newRequests > 0 && <span className="ml-1.5 text-[#ff385c]">{newRequests}</span>} →
          </Link>
        )}
      </nav>
      {mine.length > 0 && <NotifySetup email={profile?.email ?? null} />}
      {rows.length === 0 ? (
        <Empty tab={tab.id} />
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
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
      <Link href={`/applications/${a.id}`} className="flex gap-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
        <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-900">
          {a.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
            <img src={a.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="truncate font-medium">{a.listing.title}</div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(a.status)}`}>
              {STATUS[a.status].label}
            </span>
          </div>
          <div className="text-zinc-500">
            {[TYPE_LABEL[a.listing.type] ?? a.listing.type, a.source.name, dates].filter(Boolean).join(" · ")}
          </div>
          <div className="line-clamp-1 text-zinc-600 dark:text-zinc-400">
            {a.lastEvent || a.statusMessage}
            <span className="text-zinc-400"> · {timeAgo(a.updatedAt)}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

function Empty({ tab }: { tab: TabId }) {
  const copy: Record<TabId, string> = {
    active: "Nothing in progress. Tell the agent where you're headed and tap Apply on a place you like.",
    confirmed: "No confirmed stays yet. Accepted applications show up here.",
    closed: "Nothing here.",
  };
  return (
    <div className="flex flex-col items-start gap-3 py-12 text-sm text-zinc-600 dark:text-zinc-400">
      <p>{copy[tab]}</p>
      {tab === "active" && (
        <Link href="/" className="rounded-lg bg-[#ff385c] px-4 py-2 font-medium text-white hover:bg-[#e00b41]">
          Find a place
        </Link>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 border-b border-zinc-200 dark:border-zinc-800" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 py-4">
          <div className="size-20 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          </div>
        </div>
      ))}
    </div>
  );
}
