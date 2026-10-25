import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { currentUser, listRequests, type HostRequest } from "@/lib/requests";
import { DemoButton } from "./demo-button";
import { Avatar, SourceBadge, STATUS_LABELS, VERDICTS, dateRange, nights, timeAgo } from "./ui";
import { PageHeading, PageShell } from "@/components/shell/page-shell";
import { Couchbot } from "@/components/brand/logo";
import { HostingTabs } from "@/components/hosting/hosting-tabs";

export const metadata: Metadata = {
  title: "Requests",
  description: "Everyone who asked to stay at your place, from every network.",
};

export default function RequestsPage() {
  return (
    <PageShell width="wide">
      <HostingTabs active="requests" />
      <PageHeading
        title="Host requests"
        lead="Everyone who asked to stay at your place, from AgentBnB and every network your place is on."
      />
      <Suspense fallback={<ListSkeleton />}>
        <RequestList />
      </Suspense>
    </PageShell>
  );
}

async function RequestList() {
  const user = await currentUser();
  const rows = user ? await listRequests(user.id) : [];
  if (!rows.length) return <Empty />;

  const open = rows.filter((r) => r.status === "new" || r.status === "replied");
  const answered = rows.filter((r) => !open.includes(r));
  return (
    <div className="space-y-10">
      <Section title="Needs your answer" rows={open} empty="You're all caught up." />
      {answered.length > 0 && <Section title="Answered" rows={answered} />}
    </div>
  );
}

function Section({ title, rows, empty }: { title: string; rows: HostRequest[]; empty?: string }) {
  return (
    <section>
      <h2 className="text-[20px] font-semibold tracking-[-0.18px]">
        {title} <span className="font-normal text-muted">{rows.length}</span>
      </h2>
      {rows.length ? (
        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id}>
              <RequestCard r={r} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[15px] text-muted">{empty}</p>
      )}
    </section>
  );
}

function RequestCard({ r }: { r: HostRequest }) {
  const g = r.guest;
  const facts = [
    dateRange(r.startDate, r.endDate),
    nights(r.startDate, r.endDate),
    r.guestCount && r.guestCount > 1 ? `${r.guestCount} guests` : null,
  ].filter(Boolean);
  const platform = [
    g.references != null ? `${g.references} reference${g.references === 1 ? "" : "s"}` : null,
    g.memberSince ? `since ${g.memberSince.slice(0, 4)}` : null,
    g.verified ? "verified" : null,
  ].filter(Boolean);

  return (
    <Link
      href={`/requests/${r.id}`}
      className="flex h-full flex-col gap-4 rounded-[14px] border border-hairline p-5 transition-shadow hover:shadow-float"
    >
      <div className="flex items-start gap-3">
        <Avatar name={g.name} src={g.photoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-base font-semibold">{g.name}</p>
            <span className="shrink-0 text-[13px] text-muted">{timeAgo(r.receivedAt)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <SourceBadge id={r.source.id} name={r.source.name} />
            {g.location && <span className="text-[13px] text-muted">· {g.location}</span>}
          </div>
        </div>
      </div>

      {r.message && <p className="line-clamp-3 text-[14px] leading-[1.43] text-body">{r.message}</p>}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline-soft pt-3 text-[13px]">
        <span className="text-ink">
          {facts.join(" · ") || "No dates yet"}
          {platform.length > 0 && <span className="text-muted"> · {platform.join(", ")}</span>}
        </span>
        <span className="flex items-center gap-2">
          <CheckBadge check={r.check} />
          {r.status !== "new" && (
            <span className="rounded-full bg-surface-strong px-2.5 py-0.5 text-[11px] font-semibold">
              {STATUS_LABELS[r.status]}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

function CheckBadge({ check }: { check: HostRequest["check"] }) {
  if (!check) return null;
  if (check.status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        <span className="size-1.5 animate-pulse rounded-full bg-rausch" />
        Checking…
      </span>
    );
  }
  if (check.status === "failed" || !check.verdict) return null;
  const v = VERDICTS[check.verdict];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${v.text}`}>
      <span className={`size-1.5 rounded-full ${v.dot}`} />
      {v.label}
    </span>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center rounded-[14px] border border-dashed border-hairline px-6 py-14 text-center">
      <Couchbot size={72} mood="sleepy" animated className="mb-3" />
      <p className="text-[20px] font-semibold">No requests yet</p>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-muted">
        When someone asks to stay at your place, on AgentBnB or on Couchsurfing, Trustroots and the rest, the
        request shows up here. You can run a background check on anyone before you answer.
      </p>
      {process.env.NODE_ENV !== "production" && <DemoButton />}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-48 animate-pulse rounded-[14px] bg-surface-soft" />
      ))}
    </div>
  );
}
