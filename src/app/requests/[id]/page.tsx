import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCheck } from "@/lib/checks";
import { currentUser, getRequest } from "@/lib/requests";
import { BackgroundCheck } from "../background-check";
import { toJson } from "../check-types";
import { RespondButtons } from "../respond-buttons";
import { Avatar, SourceBadge, STATUS_LABELS, TopNav, dateRange, nights, timeAgo } from "../ui";

export const metadata: Metadata = { title: "Request · AgentBnB" };

export default function RequestPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <div className="min-h-dvh bg-white text-[#222]">
      <TopNav active="requests" />
      <main className="mx-auto max-w-6xl px-5 pt-6 pb-16">
        <Link href="/requests" className="text-[14px] font-medium text-[#222] hover:underline">
          ← All requests
        </Link>
        <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-[14px] bg-[#f7f7f7]" />}>
          <RequestDetail params={params} />
        </Suspense>
      </main>
    </div>
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
    <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-8">
        <div className="flex items-start gap-4">
          <Avatar name={g.name} src={g.photoUrl} size={64} />
          <div className="min-w-0">
            <h1 className="text-[22px] font-medium leading-tight tracking-[-0.44px]">{g.name} wants to stay</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <SourceBadge id={r.source.id} name={r.source.name} />
              {r.guestIsMember && (
                <span className="rounded-full bg-[#f2f2f2] px-2 py-0.5 text-[11px] font-semibold">AgentBnB member</span>
              )}
              <span className="text-[13px] text-[#6a6a6a]">· {timeAgo(r.receivedAt)}</span>
              {g.profileUrl && (
                <a
                  href={g.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] text-[#222] underline underline-offset-2"
                >
                  View profile
                </a>
              )}
            </div>
          </div>
        </div>

        {r.message && (
          <figure>
            <figcaption className="text-[14px] font-medium text-[#6a6a6a]">
              {external ? `${first}'s message` : `What ${first}'s agent wrote`}
            </figcaption>
            <blockquote className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-[#222]">{r.message}</blockquote>
          </figure>
        )}

        {(g.about || facts.some(([, v]) => v)) && (
          <div className="rounded-[14px] border border-[#ddd] p-6">
            <h2 className="text-[16px] font-semibold">What {r.source.name} shows</h2>
            {g.about && <p className="mt-2 text-[15px] leading-relaxed text-[#3f3f3f]">{g.about}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[13px] text-[#6a6a6a]">{k}</dt>
                    <dd className="text-[15px] font-medium">{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}

        <BackgroundCheck requestId={r.id} guestName={g.name} guestIsMember={r.guestIsMember} initial={toJson(check)} />
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-[14px] border border-[#ddd] p-6 shadow-[rgba(0,0,0,0.02)_0_0_0_1px,rgba(0,0,0,0.04)_0_2px_6px,rgba(0,0,0,0.1)_0_4px_8px]">
          <div className="flex items-baseline justify-between">
            <p className="text-[20px] font-semibold tracking-[-0.18px]">{stay || "No dates yet"}</p>
            <span className="rounded-full bg-[#f2f2f2] px-2.5 py-0.5 text-[11px] font-semibold">{STATUS_LABELS[r.status]}</span>
          </div>
          <dl className="mt-4 space-y-2 text-[14px]">
            {r.guestCount && (
              <div className="flex justify-between">
                <dt className="text-[#6a6a6a]">Guests</dt>
                <dd>{r.guestCount}</dd>
              </div>
            )}
            {r.listing?.title && (
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-[#6a6a6a]">Place</dt>
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
          {external && (
            <p className="mt-4 text-[13px] leading-[1.4] text-[#6a6a6a]">
              Accepting here records your answer. Send it to {first} on {r.source.name} too.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
