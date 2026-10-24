import Link from "next/link";
import { logoFor } from "@/lib/source-logos";

// Small shared pieces for the Requests pages. Tokens follow DESIGN.md: ink #222, muted #6a6a6a,
// hairline #ddd, Rausch #ff385c for the one primary action per screen.

export function TopNav({ active }: { active: "requests" | "checks" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      className={`border-b-2 pb-1 text-[15px] font-semibold transition-colors ${
        on ? "border-[#222] text-[#222]" : "border-transparent text-[#6a6a6a] hover:text-[#222]"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <header className="border-b border-[#ebebeb] bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5">
        <Link href="/" className="text-lg font-bold tracking-tight text-[#ff385c]">
          agentbnb
        </Link>
        <nav className="flex items-center gap-6">
          {tab("/applications", "Applications", false)}
          {tab("/requests", "Requests", active === "requests")}
          {tab("/me/checks", "About you", active === "checks")}
        </nav>
        <Link href="/" className="text-sm font-medium text-[#222] hover:underline">
          Chat
        </Link>
      </div>
    </header>
  );
}

export function SourceBadge({ id, name }: { id: string; name: string }) {
  const logo = logoFor(id);
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-[#6a6a6a]">
      {id === "internal" ? (
        <span className="grid size-4 place-items-center rounded-full bg-[#ff385c] text-[9px] font-bold text-white">a</span>
      ) : logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="size-4 rounded-sm object-contain" />
      ) : null}
      {name}
    </span>
  );
}

export function Avatar({ name, src, size = 48 }: { name: string; src?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[#222] font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
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
  consistent: { label: "Looks consistent", dot: "bg-emerald-600", text: "text-emerald-700" },
  some_gaps: { label: "Some gaps", dot: "bg-amber-500", text: "text-amber-700" },
  red_flags: { label: "Red flags", dot: "bg-[#c13515]", text: "text-[#c13515]" },
} as const;

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  replied: "Replied",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};
