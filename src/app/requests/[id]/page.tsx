import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCheck } from "@/lib/checks";
import { currentUser, getRequest } from "@/lib/requests";
import { BackgroundCheck } from "../background-check";
import { toJson } from "../check-types";
import { RespondButtons } from "../respond-buttons";
import { Avatar, SourceBadge, STATUS_LABELS, dateRange, nights, timeAgo } from "../ui";
import { PageShell } from "@/components/shell/page-shell";
import { SiteName } from "@/components/ui/site-name";

export const metadata: Metadata = { title: "Request" };

export default function RequestPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <PageShell width="wide" back={{ href: "/requests", label: "Host requests" }}>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[14px] bg-surface-soft" />}>
        <RequestDetail params={params} />
      </Suspense>
    </PageShell>
  );
}

async function RequestDetail({ params }: { params: PageProps<"/requests/[id]">["params"] }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) notFound();
  const r = await getRequest(user.id, id);
  if (!r) notFound();
  const check = r.check ? await getCheck(user.id, r.check.id) : null;

  const g = r.guest;
  const first = g.name.split(/\s+/)[0];
  const facts: [string, string | null | undefined][] = [
    ["From", g.location],
    ["Age", g.age ? String(g.age) : null],
    ["Member since", g.memberSince],
    ["References", g.references != null ? String(g.references) : null],
    ["Verified", g.verified == null ? null : g.verified ? "Yes" : "No"],
    ["Speaks", g.languages?.join(", ")],
  ];
  const stay = [dateRange(r.startDate, r.endDate), nights(r.startDate, r.endDate)].filter(Boolean).join(" · ");
  const external = r.source.id !== "internal";

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-8">
        <div className="flex items-start gap-4">
          {r.guestUserId ? (
            <Link href={`/people/${r.guestUserId}`} aria-label={`${g.name}'s profile`}>
              <Avatar name={g.name} src={g.photoUrl} size={64} />
            </Link>
          ) : (
            <Avatar name={g.name} src={g.photoUrl} size={64} />
          )}
          <div className="min-w-0">
            <h1 className="text-[22px] font-medium leading-tight tracking-[-0.44px]">
              {r.guestUserId ? (
                <Link href={`/people/${r.guestUserId}`} className="underline-offset-4 hover:underline">
                  {g.name}
                </Link>
              ) : (
                g.name
              )}{" "}
              wants to stay
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <SourceBadge id={r.source.id} name={r.source.name} />
              {r.guestIsMember && (
                <span className="rounded-full bg-surface-strong px-2 py-0.5 text-[11px] font-semibold">AgentBnB member</span>
              )}
              <span className="text-[13px] text-muted">· {timeAgo(r.receivedAt)}</span>
              {g.profileUrl && (
                <a
                  href={g.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] text-ink underline underline-offset-2"
                >
                  View profile
                </a>
              )}
            </div>
          </div>
        </div>

        {r.message && (
          <figure>
            <figcaption className="text-[14px] font-medium text-muted">
              {external ? `${first}'s message` : `What ${first}'s agent wrote`}
            </figcaption>
            <blockquote className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">{r.message}</blockquote>
          </figure>
        )}

        {(g.about || facts.some(([, v]) => v)) && (
          <div className="rounded-[14px] border border-hairline p-6">
            <h2 className="text-[16px] font-semibold">
              What <SiteName site={r.source.id}>{r.source.name}</SiteName> shows
            </h2>
            {g.about && <p className="mt-2 text-[15px] leading-relaxed text-body">{g.about}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[13px] text-muted">{k}</dt>
                    <dd className="text-[15px] font-medium">{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}

        <BackgroundCheck requestId={r.id} guestName={g.name} guestIsMember={r.guestIsMember} initial={toJson(check)} />
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-[14px] border border-hairline p-6 shadow-float">
          <div className="flex items-baseline justify-between">
            <p className="text-[20px] font-semibold tracking-[-0.18px]">{stay || "No dates yet"}</p>
            <span className="rounded-full bg-surface-strong px-2.5 py-0.5 text-[11px] font-semibold">{STATUS_LABELS[r.status]}</span>
          </div>
          <dl className="mt-4 space-y-2 text-[14px]">
            {r.guestCount && (
              <div className="flex justify-between">
                <dt className="text-muted">Guests</dt>
                <dd>{r.guestCount}</dd>
              </div>
            )}
            {r.listing?.title && (
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-muted">Place</dt>
                <dd className="truncate text-right">{r.listing.title}</dd>
              </div>
            )}
          </dl>
          <div className="mt-6">
            <RespondButtons
              requestId={r.id}
              status={r.status}
              platform={external ? r.source.name : null}
              platformUrl={external ? r.externalUrl : null}
            />
          </div>
          {r.applicationId && (
            <Link
              href={`/applications/${r.applicationId}`}
              className="mt-4 block text-center text-[14px] font-medium text-ink underline underline-offset-2"
            >
              Message {first} and set arrival
            </Link>
          )}
          {external && (
            <p className="mt-4 text-[13px] leading-[1.4] text-muted">
              Accepting here records your answer. Send it to {first} on{" "}
              <SiteName site={r.source.id} size={14}>
                {r.source.name}
              </SiteName>{" "}
              too.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
