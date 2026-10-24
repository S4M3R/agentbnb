import { ButtonLink, IconButton } from "@/components/ui/button";
import { CloseIcon, ExternalIcon, PinIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";
import type { StayCardData } from "./types";

/**
 * A stay card that floats over a map, as Airbnb's does when you click a price pin: photo on top,
 * a close button, then the stay and a way out to its listing. `layout="row"` puts the photo beside
 * the text, for a phone's bottom sheet. Width comes from the parent.
 */
export function StayPopupCard({
  stay,
  onClose,
  cta,
  note,
  layout = "stack",
}: {
  stay: StayCardData;
  onClose: () => void;
  /** e.g. { href, label: "View on Workaway" }; opens in a new tab. */
  cta?: { href: string; label: string; onClick?: () => void };
  /** An extra muted line, e.g. what the stay involves. */
  note?: string | null;
  layout?: "stack" | "row";
}) {
  const row = layout === "row";
  return (
    <article className={`relative overflow-hidden bg-canvas ${row ? "" : "rounded-card shadow-float"}`}>
      <div className={row ? "flex gap-3" : ""}>
        <div
          className={`relative shrink-0 overflow-hidden bg-surface-strong ${
            row ? "size-[104px] rounded-[10px]" : "aspect-[16/10] w-full"
          }`}
        >
          {stay.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
            <img
              src={stay.photo}
              alt=""
              onError={(e) => (e.currentTarget.hidden = true)}
              className="size-full object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-muted">
              <PinIcon size={24} />
            </span>
          )}
          {stay.badge && !row && (
            <span className="absolute left-3 top-3 rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-ink shadow-[0_2px_6px_rgb(0_0_0/0.14)]">
              {stay.badge}
            </span>
          )}
        </div>

        <div className={`min-w-0 flex-1 text-sm leading-5 ${row ? "pr-9" : "space-y-0.5 p-4 pb-0"}`}>
          <p className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold text-ink">{stay.place}</span>
            {stay.rating != null && <span className="shrink-0 tabular-nums">★ {stay.rating.toFixed(2)}</span>}
          </p>
          <h2 className="line-clamp-2 text-muted">{stay.title}</h2>
          {stay.detail && (
            <p className="flex min-w-0 items-center gap-1.5 text-muted">
              <SiteIcon site={stay.site} />
              <span className="truncate">
                {row && stay.badge ? `${stay.badge} · ` : ""}
                {stay.detail}
              </span>
            </p>
          )}
          {note && <p className="line-clamp-1 text-muted">{note}</p>}
          {stay.price && (
            <p className="truncate pt-1">
              <span className="font-semibold tabular-nums text-ink">{stay.price.amount}</span>
              {stay.price.period && <span className="text-body"> {stay.price.period}</span>}
            </p>
          )}
        </div>
      </div>

      {cta && (
        <div className={row ? "pt-3" : "p-4 pt-3"}>
          <ButtonLink href={cta.href} onClick={cta.onClick} size="sm" className="w-full">
            {/* The source's favicon on a white chip, so it reads on Rausch. */}
            {stay.site && (
              <span className="flex size-5 items-center justify-center rounded-[5px] bg-canvas">
                <SiteIcon site={stay.site} size={14} />
              </span>
            )}
            {cta.label}
            <ExternalIcon size={14} />
          </ButtonLink>
        </div>
      )}

      <IconButton
        label="Close"
        tone="outline"
        onClick={onClose}
        className={`absolute size-8 border-0 shadow-float ${row ? "top-0 right-0" : "top-3 right-3"}`}
      >
        <CloseIcon size={14} strokeWidth={2.4} />
      </IconButton>
    </article>
  );
}
