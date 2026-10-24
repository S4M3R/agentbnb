import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { BriefcaseIcon, CalendarIcon, CheckIcon, CloseIcon, MountainIcon } from "@/components/ui/icons";
import type { FitReason, StayPanelData } from "./types";

const FIT_ICON = { work: BriefcaseIcon, sport: MountainIcon, dates: CalendarIcon, check: CheckIcon } as const;

/**
 * One listing in full, sized to fill a side panel: photos, host, why it fits, dates and rules,
 * with `footer` pinned at the bottom for the price and the call to action.
 */
export function StayPanel({
  stay,
  label,
  onClose,
  hostAction,
  footer,
}: {
  stay: StayPanelData;
  /** Short name for the panel header, e.g. "Spare room · Alfama". */
  label: string;
  onClose: () => void;
  /** Button beside the host, e.g. "Message". */
  hostAction?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 pl-6 pr-3">
        <h2 className="truncate text-[15px] font-semibold">{label}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-strong"
        >
          <CloseIcon size={18} strokeWidth={2.2} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-7">
        <PhotoMosaic photos={stay.photos} title={stay.title} />

        <h3 className="mt-[22px] text-[26px] font-bold leading-8 tracking-[-0.025em]">{stay.title}</h3>
        {stay.subtitle && <p className="mt-1.5 text-[15px] text-body">{stay.subtitle}</p>}

        {stay.host && (
          <div className="mt-5 flex items-center gap-3.5 border-y border-hairline-soft py-[18px]">
            <Avatar name={stay.host.name} src={stay.host.photo} size={52} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Hosted by {stay.host.name}</p>
              {stay.host.detail && <p className="text-sm text-muted">{stay.host.detail}</p>}
            </div>
            {hostAction}
          </div>
        )}

        {stay.fit && stay.fit.length > 0 && (
          <Section title="Why it fits">
            <ul className="flex flex-col gap-[18px]">
              {stay.fit.map((f) => (
                <FitRow key={f.title} reason={f} />
              ))}
            </ul>
          </Section>
        )}

        {stay.dates && stay.dates.length > 0 && (
          <Section title="Open dates">
            <Pills items={stay.dates} />
          </Section>
        )}

        {stay.rules && stay.rules.length > 0 && (
          <Section title="House rules">
            <Pills items={stay.rules} />
          </Section>
        )}

        {stay.description && (
          <Section title="About this place">
            <p className="whitespace-pre-line text-[15px] leading-6 text-body">{stay.description}</p>
          </Section>
        )}
      </div>

      {footer && (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline-soft px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          {footer}
        </footer>
      )}
    </div>
  );
}

function PhotoMosaic({ photos, title }: { photos: string[]; title: string }) {
  const [hero, ...rest] = photos;
  if (!hero) return null;
  const thumbs = rest.slice(0, 4);
  return (
    <div
      className={`grid h-64 gap-1.5 overflow-hidden rounded-2xl sm:h-[300px] ${thumbs.length >= 4 ? "grid-cols-[2fr_1fr_1fr] grid-rows-2" : thumbs.length ? "grid-cols-[2fr_1fr] grid-rows-2" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- third-party listing photos */}
      <img src={hero} alt={title} className="row-span-2 size-full object-cover" />
      {thumbs.map((src) => (
        // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
        <img key={src} src={src} alt="" loading="lazy" className="size-full min-h-0 object-cover" />
      ))}
    </div>
  );
}

function FitRow({ reason }: { reason: FitReason }) {
  const Icon = FIT_ICON[reason.icon];
  return (
    <li className="flex gap-4">
      <Icon size={26} strokeWidth={1.6} className="shrink-0" />
      <div>
        <p className="font-semibold">{reason.title}</p>
        {reason.detail && <p className="text-sm text-muted">{reason.detail}</p>}
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h4 className="mb-3.5 text-lg font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function Pills({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((t) => (
        <li key={t} className="rounded-[17px] bg-surface-soft px-3.5 py-1.5 text-sm leading-[22px]">
          {t}
        </li>
      ))}
    </ul>
  );
}
