import { Avatar } from "@/components/ui/avatar";
import { CheckIcon, MoonIcon, PinIcon } from "@/components/ui/icons";
import { SiteIcon } from "@/components/ui/site-name";
import type { StayCardData } from "./types";
import { SaveHeart } from "./save-heart";

/** Photo-first stay card: host face on the photo, place and price, then why it fits. Width comes from the parent. */
export function StayCard({
  stay,
  onOpen,
  saved,
  onToggleSave,
  onApply,
  onAddToList,
  inList,
  onHoverChange,
}: {
  stay: StayCardData;
  /** Called on click. With `stay.href` the card is a link and this runs alongside it. */
  onOpen?: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
  /** Adds an "Apply now" button under the card. */
  onApply?: () => void;
  /**
   * Adds an "Add to list" button beside it; with `inList` it reads "Added" and clicking removes the
   * stay. Gets the button, so the photo can fly from this card to the list.
   */
  onAddToList?: (from: HTMLElement) => void;
  inList?: boolean;
  /** Pointer entering (true) or leaving (false) the card, e.g. to highlight its map pin. */
  onHoverChange?: (hovering: boolean) => void;
}) {
  const body = <CardBody stay={stay} />;
  const opener = "flex w-full flex-col gap-3 rounded-card text-left";
  return (
    <article
      className="group relative"
      onMouseEnter={onHoverChange && (() => onHoverChange(true))}
      onMouseLeave={onHoverChange && (() => onHoverChange(false))}
    >
      {stay.href ? (
        <a href={stay.href} target="_blank" rel="noreferrer" onClick={onOpen} className={opener}>
          {body}
        </a>
      ) : (
        <button type="button" onClick={onOpen} className={opener}>
          {body}
        </button>
      )}

      {(onApply || onAddToList) && (
        <div className="mt-3 flex gap-2 px-0.5">
          {onApply && (
            <button
              type="button"
              onClick={onApply}
              aria-label={`Apply now to ${stay.title}`}
              className={`h-9 rounded-lg bg-rausch px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-rausch-active ${onAddToList ? "flex-1" : ""}`}
            >
              {onAddToList ? "Apply now" : "Apply"}
            </button>
          )}
          {onAddToList && (
            <button
              type="button"
              onClick={(e) => onAddToList(e.currentTarget)}
              aria-pressed={inList}
              aria-label={inList ? `Remove ${stay.title} from your apply list` : `Add ${stay.title} to your apply list`}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-[color,background-color,border-color,transform] active:scale-[0.97] motion-reduce:transition-colors ${
                inList ? "border-ink bg-surface-soft text-ink" : "border-hairline bg-canvas text-ink hover:border-ink"
              }`}
            >
              {inList ? (
                <>
                  <CheckIcon size={14} strokeWidth={2.6} className="motion-safe:animate-pop" />
                  Added
                </>
              ) : (
                "Add to list"
              )}
            </button>
          )}
        </div>
      )}

      {onToggleSave && <SaveHeart title={stay.title} saved={saved} onToggle={onToggleSave} />}
    </article>
  );
}

function CardBody({ stay }: { stay: StayCardData }) {
  return (
    <>
      <span data-stay-photo className="relative block aspect-[20/19] w-full overflow-hidden rounded-card bg-surface-strong">
        {stay.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
          <img
            src={stay.photo}
            alt=""
            loading="lazy"
            // Hotlinked photos sometimes 404; the gray plate behind shows instead.
            onError={(e) => (e.currentTarget.hidden = true)}
            className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted">
            <PinIcon size={28} />
          </span>
        )}
        {stay.badge && (
          <span className="absolute left-3 top-3 rounded-full bg-canvas px-[11px] py-1 text-[13px] font-semibold text-ink shadow-[0_2px_6px_rgb(0_0_0/0.14)]">
            {stay.badge}
          </span>
        )}
        {stay.host && (
          <Avatar
            name={stay.host.name}
            src={stay.host.photo}
            size={48}
            className="absolute bottom-3 left-3 ring-[3px] ring-canvas shadow-[0_4px_12px_rgb(0_0_0/0.25)]"
          />
        )}
      </span>

      <span className="flex flex-col gap-0.5 px-0.5 text-[15px] leading-5">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{stay.place}</span>
          {stay.nights != null ? (
            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums">
              <MoonIcon size={13} className="text-rausch" />
              {stay.nights} {stay.nights === 1 ? "night" : "nights"}
            </span>
          ) : (
            stay.rating != null && <span className="shrink-0 text-sm tabular-nums">★ {stay.rating.toFixed(2)}</span>
          )}
        </span>
        <span className="truncate text-muted">{stay.title}</span>
        {stay.detail && (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <SiteIcon site={stay.site} />
            <span className="truncate">{stay.detail}</span>
          </span>
        )}
        {stay.price && (
          <span className="mt-1 truncate">
            <span className="font-semibold tabular-nums">{stay.price.amount}</span>
            {stay.price.period && <span className="text-body"> {stay.price.period}</span>}
          </span>
        )}
      </span>

      {stay.reasons && stay.reasons.length > 0 && (
        <span className="flex flex-wrap gap-1.5 px-0.5">
          {stay.reasons.map((r) => (
            <span
              key={r}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-rausch-soft pl-2 pr-2.5 text-[13px] font-semibold text-rausch-deep"
            >
              <CheckIcon size={13} strokeWidth={3} />
              {r}
            </span>
          ))}
        </span>
      )}
    </>
  );
}
