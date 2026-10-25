import type { ReactNode } from "react";
import { Couchbot, type CouchbotMood } from "@/components/brand/logo";
import { SiteIcon } from "@/components/ui/site-name";
import { RichText } from "./rich-text";

/** The guest's turn: their text in a bubble, with any photos they attached above it. */
export function UserMessage({ children, photos = [] }: { children: ReactNode; photos?: string[] }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {photos.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {photos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- photos the guest uploaded to Blob
            <img key={src} src={src} alt="" className="size-24 rounded-2xl object-cover" />
          ))}
        </div>
      )}
      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-surface-strong px-4 py-2.5 text-[15px] leading-[22px] text-ink sm:max-w-[78%] sm:px-[18px] sm:py-3 sm:text-base sm:leading-6">
        {children}
      </div>
    </div>
  );
}

type ApplyPlace = { id: string; title: string; photo?: string | null; site?: string | null };

/** The guest's "apply to these places" turn, drawn as small cards instead of the prompt the agent reads. */
export function ApplyRequest({ places }: { places: ApplyPlace[] }) {
  const one = places.length === 1;
  const shown = places.slice(0, 5);
  const names = places.slice(0, 2).map((p) => p.title);
  return (
    <div className="flex flex-col items-end">
      <div className="flex max-w-[85%] flex-col gap-2.5 rounded-3xl bg-surface-strong px-4 py-3 sm:max-w-[78%] sm:px-[18px]">
        <div className="text-[15px] font-semibold leading-5 sm:text-base">
          {one ? "Apply to this place" : `Apply to ${places.length} places`}
        </div>
        {one ? (
          <div className="flex items-center gap-3">
            <PlaceThumb place={places[0]} />
            <span className="line-clamp-2 min-w-0 text-[14px] leading-5 text-body">{places[0].title}</span>
          </div>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2" aria-label="Places">
              {shown.map((p) => (
                <li key={p.id} title={p.title}>
                  <PlaceThumb place={p} />
                </li>
              ))}
              {places.length > shown.length && (
                <li className="flex size-14 items-center justify-center rounded-xl bg-canvas text-sm font-semibold text-muted">
                  +{places.length - shown.length}
                </li>
              )}
            </ul>
            <p className="line-clamp-2 text-[13px] leading-[18px] text-muted">
              {names.join(", ")}
              {places.length > names.length && ` and ${places.length - names.length} more`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function PlaceThumb({ place }: { place: ApplyPlace }) {
  return (
    <span className="relative block size-14 shrink-0">
      {place.photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- listing photos come from many hosts
        <img src={place.photo} alt="" className="size-full rounded-xl object-cover" />
      ) : (
        <span className="block size-full rounded-xl bg-canvas" />
      )}
      {place.site && (
        <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-canvas shadow-[0_0_0_1px_rgb(0_0_0/0.06)]">
          <SiteIcon site={place.site} size={13} />
        </span>
      )}
    </span>
  );
}

/**
 * The agent's turn: Couchbot beside a column of text and tool results. `mood` is its face
 * (thinking while it works); `live` animates it, which only the newest turn should do.
 */
export function AssistantMessage({
  children,
  mood = "idle",
  live = false,
}: {
  children: ReactNode;
  mood?: CouchbotMood;
  live?: boolean;
}) {
  return (
    <div className="flex gap-2.5 sm:gap-4">
      <Couchbot size={30} mood={mood} animated={live} className="mt-0.5 size-6 shrink-0 sm:size-[30px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">{children}</div>
    </div>
  );
}

export function AssistantText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap text-[15px] leading-6 text-ink sm:text-base sm:leading-[26px]">
      <RichText text={text} />
    </div>
  );
}

/** A tool call in flight ("Searching Oakland…") or one that failed. */
export function ToolStatus({ label, failed = false }: { label: string; failed?: boolean }) {
  if (failed) return <p className="text-sm text-error">{label}</p>;
  return (
    <p className="flex items-center gap-2.5 text-sm font-medium text-muted" role="status">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-rausch opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-rausch" />
      </span>
      <span className="animate-shimmer">{label}</span>
    </p>
  );
}

/** A centered line between turns, e.g. "Today 18:05 · You asked me to request all three". */
export function SystemNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-[13px] text-muted">
      <span className="h-px flex-1 bg-hairline-soft" />
      <span className="text-center">{children}</span>
      <span className="h-px flex-1 bg-hairline-soft" />
    </p>
  );
}
