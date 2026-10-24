import type { RequestStatus } from "./types";

type StatusStyle = {
  label: string;
  /** Step reached in sent → interested → accepted → confirmed; 0 when withdrawn. */
  step: number;
  pill: string;
  /** Fill for progress steps and the dot on the host's face. */
  fill: string;
  /** The countdown line for this status, e.g. "Confirm in 3h 40m"; null while there is no deadline. */
  countdown: (timeLeft?: string) => string | null;
};

export const STATUS: Record<RequestStatus, StatusStyle> = {
  sent: {
    label: "Sent",
    step: 1,
    pill: "bg-hairline-soft text-body",
    fill: "bg-muted",
    countdown: (t) => (t ? `Replies in ${t}` : null),
  },
  interested: {
    label: "Interested",
    step: 2,
    pill: "bg-amber-soft text-amber",
    fill: "bg-amber-dot",
    countdown: (t) => (t ? `Decides in ${t}` : null),
  },
  accepted: {
    label: "Accepted",
    step: 3,
    pill: "bg-success-soft text-success",
    fill: "bg-success-dot",
    countdown: (t) => (t ? `Confirm in ${t}` : null),
  },
  confirmed: {
    label: "Confirmed",
    step: 4,
    pill: "bg-ink text-white",
    fill: "bg-ink",
    countdown: () => "Booked",
  },
  withdrawn: {
    label: "Withdrawn",
    step: 0,
    pill: "bg-surface-strong text-muted",
    fill: "bg-hairline",
    countdown: () => "Closed",
  },
};

export function StatusPill({ status, className = "" }: { status: RequestStatus; className?: string }) {
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11px] font-bold ${STATUS[status].pill} ${className}`}
    >
      {STATUS[status].label}
    </span>
  );
}

/** Four short bars for sent, interested, accepted and confirmed, filled up to the current status. */
export function StatusSteps({ status }: { status: RequestStatus }) {
  const { step, fill } = STATUS[status];
  return (
    <span
      role="img"
      aria-label={step ? `Step ${step} of 4: sent, interested, accepted, confirmed` : "Withdrawn"}
      className="flex w-full max-w-[220px] gap-1"
    >
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`h-1 flex-1 rounded-full ${n <= step ? fill : "bg-hairline-soft"}`} />
      ))}
    </span>
  );
}
