import type { PublishStatus, PublishTone } from "./types";

const TONES: Record<PublishTone, { pill: string; dot?: string }> = {
  live: { pill: "bg-success-soft text-success", dot: "bg-success-dot" },
  working: { pill: "bg-surface-strong text-body", dot: "bg-rausch motion-safe:animate-pulse" },
  attention: { pill: "bg-amber-soft text-amber", dot: "bg-amber-dot" },
  failed: { pill: "bg-rausch-soft text-error" },
  idle: { pill: "border border-hairline text-muted" },
  draft: { pill: "bg-surface-strong text-body" },
};

/** A small status chip: "Live", "Publishing…", "Needs you", "Failed", "Not listed". */
export function PublishChip({ status, className = "" }: { status: PublishStatus; className?: string }) {
  const tone = TONES[status.tone];
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-bold ${tone.pill} ${className}`}
    >
      {tone.dot && <span aria-hidden="true" className={`size-1.5 rounded-full ${tone.dot}`} />}
      {status.label}
    </span>
  );
}
