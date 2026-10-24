import type { ReactNode } from "react";
import { ExternalIcon, HomeIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";
import { PublishChip } from "./publish-status";
import type { HostListingCardData, ListedPlace } from "./types";

/**
 * One of the host's listings: photo, title, area and kind, status and open dates, then "Where
 * it's listed" (AgentBnB plus every network, each with its status and next step) and the
 * listing's actions. `onPlaceAction` gets the place id when a row's button is pressed.
 */
export function HostListingCard({
  listing: l,
  places,
  onPlaceAction,
  actions,
  busyPlace,
}: {
  listing: HostListingCardData;
  places: ListedPlace[];
  onPlaceAction?: (placeId: string) => void;
  /** Buttons along the bottom: publish/pause, list on more sites, edit in chat. */
  actions?: ReactNode;
  /** A row whose action is in flight. */
  busyPlace?: string | null;
}) {
  const live = places.filter((p) => p.status.tone === "live").length;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-hairline bg-canvas">
      <div className="relative aspect-[3/2] bg-surface-soft">
        {l.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Blob photos
          <img src={l.photo} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted">
            <HomeIcon size={28} />
            No photos yet
          </div>
        )}
        <PublishChip status={l.status} className="absolute left-3 top-3 shadow-float" />
        {l.photoCount > 1 && (
          <span className="absolute bottom-3 right-3 rounded-full bg-canvas/90 px-2 py-0.5 text-[11px] font-semibold text-ink">
            {l.photoCount} photos
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="truncate text-[13px] text-muted">{[l.kind, l.place].filter(Boolean).join(" · ")}</p>
          <h2 className="mt-0.5 text-[17px] font-semibold leading-snug text-ink">{l.title}</h2>
          <p className="mt-0.5 text-sm text-body">{l.arrangement}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {l.dates.length ? (
              l.dates.map((d) => (
                <span key={d} className="inline-flex h-7 items-center rounded-full border border-hairline px-2.5 text-[13px] text-ink">
                  {d}
                </span>
              ))
            ) : (
              <span className="text-[13px] text-muted">No open dates yet</span>
            )}
          </div>
        </div>

        <section aria-label="Where it's listed" className="border-t border-hairline-soft pt-3">
          <h3 className="flex items-baseline justify-between text-sm font-semibold text-ink">
            Where it&apos;s listed
            <span className="text-[13px] font-normal text-muted">
              {live} of {places.length} live
            </span>
          </h3>
          <ul className="mt-1 divide-y divide-hairline-soft">
            {places.map((p) => (
              <li key={p.id} className="flex min-h-12 items-center gap-3 py-2">
                <SiteIcon site={p.id} size={20} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                  {p.detail && <span className="truncate text-[12px] leading-4 text-muted">{p.detail}</span>}
                </span>
                <PublishChip status={p.status} />
                <PlaceButton place={p} busy={busyPlace === p.id} onAction={onPlaceAction} />
              </li>
            ))}
          </ul>
        </section>

        {actions && <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-hairline-soft pt-4">{actions}</div>}
      </div>
    </article>
  );
}

function PlaceButton({
  place: p,
  busy,
  onAction,
}: {
  place: ListedPlace;
  busy: boolean;
  onAction?: (id: string) => void;
}) {
  const a = p.action;
  // A fixed width keeps the chips lined up whether or not a row has an action.
  if (!a) return <span aria-hidden="true" className="w-[68px] shrink-0" />;
  const cls =
    "inline-flex h-8 w-[68px] shrink-0 items-center justify-center gap-1 rounded-lg text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  if (a.kind === "link") {
    return (
      <a
        href={a.href}
        target="_blank"
        rel="noreferrer"
        aria-label={`${a.label} on ${p.name}`}
        className={`${cls} text-ink underline-offset-2 hover:bg-surface-strong`}
      >
        {a.label}
        <ExternalIcon size={13} />
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onAction?.(p.id)}
      aria-label={`${a.label}: ${p.name}`}
      className={`${cls} ${a.emphasis ? "bg-ink text-white hover:bg-body" : "border border-hairline text-ink hover:border-ink"}`}
    >
      {busy ? "…" : a.label}
    </button>
  );
}
