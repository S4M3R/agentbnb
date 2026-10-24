import type { ApplicationStatus } from "@/lib/applications";

export const STATUS: Record<ApplicationStatus, { label: string; tone: "neutral" | "busy" | "attention" | "good" | "bad" }> = {
  draft: { label: "Ready to send", tone: "attention" },
  queued: { label: "Sending", tone: "busy" },
  sending: { label: "Sending", tone: "busy" },
  needs_user: { label: "Needs you", tone: "attention" },
  sent: { label: "Waiting for host", tone: "neutral" },
  accepted: { label: "Accepted", tone: "good" },
  scheduled: { label: "Scheduled", tone: "good" },
  declined: { label: "Declined", tone: "bad" },
  cancelled: { label: "Withdrawn", tone: "bad" },
  failed: { label: "Couldn't send", tone: "bad" },
};

const TONE = {
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  busy: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 animate-pulse",
  attention: "bg-[#fff0f3] text-[#e00b41] dark:bg-[#3a0a15] dark:text-[#ff8aa1]",
  good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  bad: "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
};

export function statusClass(status: ApplicationStatus) {
  return TONE[STATUS[status].tone];
}

/** How a request looks to the host of an AgentBnB listing. */
export function hostStatus(status: ApplicationStatus) {
  const label: Partial<Record<ApplicationStatus, string>> = {
    sent: "New request",
    accepted: "You accepted",
    declined: "You declined",
    cancelled: "Withdrawn",
  };
  return {
    label: label[status] ?? STATUS[status].label,
    cls: statusClass(status === "sent" ? "needs_user" : status),
  };
}

/** A status change on the timeline, in the host's words. Null: not the host's business. */
export function hostEventText(to: ApplicationStatus | undefined, body: string | null, guest: string) {
  switch (to) {
    case "sent":
      return `${guest} sent a request.`;
    case "accepted":
      return "You accepted.";
    case "declined":
      return "You declined.";
    case "cancelled":
      return `${guest} withdrew the request.`;
    case "scheduled":
      return body;
    default:
      return null;
  }
}

/** Statuses where something is about to change on its own, so the page should refresh often. */
export const TRANSIENT: ApplicationStatus[] = ["queued", "sending"];

export const TYPE_LABEL: Record<string, string> = {
  house_sit: "House sit",
  work_exchange: "Work exchange",
  farm_stay: "Farm stay",
  couch: "Couch",
  private_room: "Private room",
  shared_room: "Shared room",
  entire_place: "Entire place",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatRange(start: string | null, end: string | null) {
  if (!start) return null;
  const [sy, sm, sd] = start.split("-").map(Number);
  if (!end || end === start) return `${MONTHS[sm - 1]} ${sd}`;
  const [ey, em, ed] = end.split("-").map(Number);
  const s = `${MONTHS[sm - 1]} ${sd}`;
  if (sy !== ey) return `${s}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
  return sm === em ? `${s} – ${ed}` : `${s} – ${MONTHS[em - 1]} ${ed}`;
}

export function timeAgo(d: Date | string) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
