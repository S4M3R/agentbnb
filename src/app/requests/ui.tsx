import type { ComponentProps } from "react";
import { Avatar as BaseAvatar } from "@/components/ui/avatar";
import { SiteName } from "@/components/ui/site-name";

// Small shared pieces for the Requests pages. Colors are the DESIGN.md tokens from globals.css;
// Rausch is kept for the one primary action per screen.

/** A request's or listing's source: its favicon and name, in muted meta text. */
export function SourceBadge({ id, name }: { id: string; name: string }) {
  return (
    <SiteName site={id} className="text-[13px] text-muted">
      {name}
    </SiteName>
  );
}

/** The shared avatar at the request pages' default 48px. */
export function Avatar(props: ComponentProps<typeof BaseAvatar>) {
  return <BaseAvatar size={48} {...props} />;
}

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function dateRange(start: string | null, end: string | null) {
  if (!start) return null;
  const s = fmt.format(new Date(`${start}T00:00:00Z`));
  if (!end || end === start) return s;
  return `${s} – ${fmt.format(new Date(`${end}T00:00:00Z`))}`;
}

export function nights(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const n = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
  return n > 0 ? `${n} night${n === 1 ? "" : "s"}` : null;
}

export function timeAgo(date: Date | string) {
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const VERDICTS = {
  consistent: { label: "Looks consistent", dot: "bg-success-dot", text: "text-success" },
  some_gaps: { label: "Some gaps", dot: "bg-amber-dot", text: "text-amber" },
  red_flags: { label: "Red flags", dot: "bg-error", text: "text-error" },
} as const;

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  replied: "Replied",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};
