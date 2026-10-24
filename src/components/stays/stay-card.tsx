import { Avatar } from "@/components/ui/avatar";
import { CheckIcon, HeartIcon, MoonIcon, PinIcon } from "@/components/ui/icons";
import type { StayCardData } from "./types";

/** Photo-first stay card: host face on the photo, place and price, then why it fits. Width comes from the parent. */
export function StayCard({
  stay,
  onOpen,
  saved,
  onToggleSave,
  onApply,
}: {
  stay: StayCardData;
  onOpen: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
  /** Adds an Apply button under the card. */
  onApply?: () => void;
}) {
  return (
    <article className="group relative">
      <button type="button" onClick={onOpen} className="flex w-full flex-col gap-3 rounded-card text-left">
        <span className="relative block aspect-[20/19] w-full overflow-hidden rounded-card bg-surface-strong">
          {stay.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
            <img
              src={stay.photo}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
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
          {stay.detail && <span className="truncate text-muted">{stay.detail}</span>}
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
      </button>

      {onApply && (
        <button
          type="button"
          onClick={onApply}
          aria-label={`Apply to ${stay.title}`}
          className="mt-3 ml-0.5 h-8 rounded-lg bg-rausch px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-rausch-active"
        >
          Apply
        </button>
      )}

      {onToggleSave && (
        <button
          type="button"
          onClick={onToggleSave}
          aria-label={saved ? `Remove ${stay.title} from saved` : `Save ${stay.title}`}
          aria-pressed={saved}
          className="absolute right-2 top-2 flex size-10 items-center justify-center rounded-full transition-transform active:scale-90"
        >
          <HeartIcon
            size={24}
            className={saved ? "fill-rausch text-white" : "fill-black/45 text-white"}
          />
        </button>
      )}
    </article>
  );
}
