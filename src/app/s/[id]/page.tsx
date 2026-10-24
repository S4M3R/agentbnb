import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getShareLink, type SharedListing } from "@/lib/share-links";
import { SourceBadge, dateRange } from "../../requests/ui";

// A link an agent sent someone (usually Instinct, in iMessage): the stays it picked, as cards.
// Most people land here from their phone, so it's laid out for a narrow screen first.

const TYPE_LABEL: Record<string, string> = {
  house_sit: "House sit",
  work_exchange: "Work exchange",
  farm_stay: "Farm stay",
  couch: "Couch",
  private_room: "Private room",
  shared_room: "Shared room",
  entire_place: "Entire place",
};

export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  const { id } = await params;
  const view = await getShareLink(id);
  if (!view) notFound(); // link-preview bots get metadata before the page streams, so they see a real 404
  const description = describe(view);
  return {
    title: view.title,
    description,
    openGraph: { title: view.title, description, siteName: "AgentBnB", type: "website" },
    twitter: { card: "summary_large_image", title: view.title, description },
  };
}

function describe(view: NonNullable<Awaited<ReturnType<typeof getShareLink>>>) {
  const n = view.listings.length;
  const one = view.listings[0];
  const parts =
    n === 1
      ? [one.location, TYPE_LABEL[one.type] ?? one.type, one.source.id === "internal" ? "AgentBnB host" : one.source.name]
      : [`${n} stays`, dateRange(view.startDate, view.endDate)];
  return view.note ?? parts.filter(Boolean).join(" · ");
}

export default function SharePage({ params }: PageProps<"/s/[id]">) {
  return (
    <div className="min-h-dvh bg-white text-[#222]">
      <Suspense fallback={<Skeleton />}>
        <Shared params={params} />
      </Suspense>
    </div>
  );
}

async function Shared({ params }: { params: PageProps<"/s/[id]">["params"] }) {
  const { id } = await params;
  const view = await getShareLink(id);
  if (!view) notFound();
  const single = view.listings.length === 1 ? view.listings[0] : null;
  const dates = dateRange(view.startDate, view.endDate);

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-[#ebebeb] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="text-lg font-bold tracking-tight text-[#ff385c]">
            agentbnb
          </Link>
          {view.agent && (
            <span className="rounded-full bg-[#f2f2f2] px-3 py-1 text-[12px] font-semibold">
              Sent by {view.agent.name}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pt-6 pb-16">
        {single ? (
          <ListingView listing={single} />
        ) : (
          <>
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.44px]">{view.title}</h1>
            <p className="mt-1 text-[14px] text-[#6a6a6a]">
              {[view.note, `${view.listings.length} stays`, dates].filter(Boolean).join(" · ")}
            </p>
            {view.listings.length === 0 ? (
              <p className="mt-10 rounded-[14px] bg-[#f7f7f7] p-6 text-[15px] text-[#3f3f3f]">
                These stays aren&apos;t listed anymore. Ask your agent to search again.
              </p>
            ) : (
              <div className="mt-6 grid gap-8 sm:grid-cols-2">
                {view.listings.map((l, i) => (
                  <ListingCard key={l.id} listing={l} rank={i + 1} />
                ))}
              </div>
            )}
          </>
        )}

        <footer className="mt-14 border-t border-[#ebebeb] pt-6 text-[13px] leading-relaxed text-[#6a6a6a]">
          {view.agent ? `${view.agent.name} found these with AgentBnB` : "Found with AgentBnB"}, which searches
          house sits, work exchanges and couches across every marketplace, plus hosts on its own network. To ask
          about a place, just reply in your chat
          {view.agent ? ` with ${view.agent.name}` : ""}, or{" "}
          <Link href="/" className="font-medium text-[#222] underline underline-offset-2">
            chat with AgentBnB
          </Link>
          .
        </footer>
      </main>
    </>
  );
}

const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const long = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Oct 24 – Nov 7", with years when the window spans one ("Oct 24, 2026 – Oct 24, 2027"). */
function windowLabel(start: string, end: string) {
  if (start === end) return short.format(new Date(`${start}T00:00:00Z`));
  if (start.slice(0, 4) === end.slice(0, 4)) return dateRange(start, end);
  return `${long.format(new Date(`${start}T00:00:00Z`))} – ${long.format(new Date(`${end}T00:00:00Z`))}`;
}

function Chips({ listing: l }: { listing: SharedListing }) {
  const chips = [
    ...l.dates.map((d) => windowLabel(d.start, d.end)),
    l.maxGuests && `Up to ${l.maxGuests} guest${l.maxGuests === 1 ? "" : "s"}`,
    ...l.highlights,
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={String(c)} className="rounded-full bg-[#f2f2f2] px-2.5 py-1 text-[12px] font-medium">
          {c}
        </span>
      ))}
    </div>
  );
}

function Cta({ listing: l }: { listing: SharedListing }) {
  if (l.source.id === "internal") {
    return (
      <p className="rounded-[14px] bg-[#f7f7f7] px-4 py-3 text-[14px] text-[#3f3f3f]">
        {l.status === "active"
          ? `Hosted on AgentBnB${l.host ? ` by ${l.host}` : ""}. Reply in your chat to ask about a stay.`
          : "This is a draft. Guests can't find it until you say to publish it."}
      </p>
    );
  }
  if (!l.url) return null;
  return (
    <a
      href={l.url}
      target="_blank"
      rel="noreferrer"
      className="flex h-12 items-center justify-center rounded-[8px] bg-[#ff385c] px-6 text-[16px] font-medium text-white transition-colors hover:bg-[#e00b41]"
    >
      Open on {l.source.name}
    </a>
  );
}

function ListingView({ listing: l }: { listing: SharedListing }) {
  return (
    <article className="space-y-5">
      {l.photos.length > 0 && (
        <div className="-mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          {l.photos.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
            <img
              key={src}
              src={src}
              alt=""
              loading={i < 2 ? "eager" : "lazy"}
              className="aspect-[4/3] w-[85%] shrink-0 snap-center rounded-[14px] object-cover sm:w-[70%]"
            />
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#6a6a6a]">
          <span>{TYPE_LABEL[l.type] ?? l.type}</span>
          <span>·</span>
          <SourceBadge id={l.source.id} name={l.source.id === "internal" ? "AgentBnB" : l.source.name} />
          {l.status !== "active" && (
            <span className="rounded-full bg-[#f2f2f2] px-2 py-0.5 text-[11px] font-semibold text-[#222]">Draft</span>
          )}
        </div>
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.44px]">{l.title}</h1>
        {l.location && <p className="text-[15px] text-[#3f3f3f]">{l.location}</p>}
      </div>
      <Chips listing={l} />
      <Cta listing={l} />
      {l.summary && <p className="whitespace-pre-line text-[15px] leading-relaxed text-[#3f3f3f]">{l.summary}</p>}
      {l.host && l.source.id !== "internal" && <p className="text-[14px] text-[#6a6a6a]">Hosted by {l.host}</p>}
    </article>
  );
}

function ListingCard({ listing: l, rank }: { listing: SharedListing; rank: number }) {
  const [cover] = l.photos;
  return (
    <article className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-[#f2f2f2]">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
          <img src={cover} alt="" loading={rank <= 2 ? "eager" : "lazy"} className="h-full w-full object-cover" />
        )}
        <span className="absolute top-3 left-3 rounded-full bg-white px-2.5 py-1 text-[12px] font-semibold shadow-sm">
          {rank === 1 ? "Top pick" : `#${rank}`}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[13px] text-[#6a6a6a]">
          <span>{TYPE_LABEL[l.type] ?? l.type}</span>
          <span>·</span>
          <SourceBadge id={l.source.id} name={l.source.id === "internal" ? "AgentBnB" : l.source.name} />
        </div>
        <h2 className="line-clamp-2 text-[16px] font-semibold leading-snug">{l.title}</h2>
        {l.location && <p className="text-[14px] text-[#6a6a6a]">{l.location}</p>}
      </div>
      <Chips listing={l} />
      {l.summary && <p className="line-clamp-3 text-[14px] leading-relaxed text-[#3f3f3f]">{l.summary}</p>}
      <Cta listing={l} />
    </article>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-3xl px-5 pt-20">
      <div className="aspect-[4/3] w-full animate-pulse rounded-[14px] bg-[#f2f2f2]" />
      <div className="mt-5 h-6 w-2/3 animate-pulse rounded bg-[#f2f2f2]" />
      <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-[#f2f2f2]" />
    </div>
  );
}
