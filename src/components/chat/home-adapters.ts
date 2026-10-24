import type { AgentUIMessage } from "@/lib/agent/tools";
import type { AttentionItem, AttentionKind } from "@/lib/attention";
import type { ChatSummary } from "@/lib/chat-history";
import type { AttentionRow } from "./attention";
import type { RecentChat } from "./recent-chats";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 stays found · 2 applications": what happened in a chat, from its tool results. */
export function chatHint(messages: AgentUIMessage[]): string | undefined {
  let stays = 0;
  let searched = false;
  const applications = new Set<string>();
  let listing: "published" | "drafted" | null = null;
  for (const m of messages)
    for (const p of m.parts) {
      if (p.type === "tool-searchStays" && p.state === "output-available") {
        // The latest search is the one that counts: a widened search re-counts the first one's stays.
        searched = true;
        stays = p.output.total;
      }
      if ((p.type === "tool-applyToListings" || p.type === "tool-sendApplications") && p.state === "output-available")
        if (!("error" in p.output))
          for (const a of "drafts" in p.output ? p.output.drafts : p.output.applications) applications.add(a.id);
      if (p.type === "tool-publishListing" && p.state === "output-available" && !("error" in p.output)) listing = "published";
      if (p.type === "tool-saveListingDraft" && p.state === "output-available" && !("error" in p.output))
        listing ??= "drafted";
    }
  const parts = [
    searched && (stays ? `${plural(stays, "stay")} found` : "No stays found"),
    applications.size > 0 && plural(applications.size, "application"),
    listing && `Listing ${listing}`,
  ].filter(Boolean);
  if (parts.length) return parts.join(" · ");

  // No tools: the start of the agent's last reply.
  const text = messages
    .findLast((m) => m.role === "assistant")
    ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join(" ")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? (text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text) : undefined;
}

/** "just now", "5m ago", "3h ago", "Yesterday", "4d ago", then the date. */
export function relativeTime(at: number | string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(at).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2 * 86400) return "Yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function toRecentChat(c: ChatSummary, now?: number): RecentChat {
  return { id: c.id, title: c.title, href: `/?c=${c.id}`, hint: c.hint, when: relativeTime(c.updatedAt, now) };
}

const ACTION: Record<AttentionKind, string> = {
  application_needs_user: "Open browser",
  application_failed: "Retry",
  confirm_arrival: "Confirm arrival",
  withdraw_overlapping: "Review",
  message: "Reply",
  stay_request: "Reply",
  publication_needs_user: "Open browser",
  publication_failed: "Retry",
  notification: "Open",
};

const ICON: Record<AttentionKind, AttentionRow["icon"]> = {
  application_needs_user: "browser",
  application_failed: "alert",
  confirm_arrival: "calendar",
  withdraw_overlapping: "suitcase",
  message: "message",
  stay_request: "home",
  publication_needs_user: "browser",
  publication_failed: "alert",
  notification: "bell",
};

export function toAttentionRow(item: AttentionItem, now?: number): AttentionRow {
  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    href: item.href,
    site: item.site,
    icon: ICON[item.kind] ?? "bell",
    action: ACTION[item.kind] ?? "Open",
    urgent: item.urgency === "urgent",
    when: relativeTime(item.at, now),
  };
}
