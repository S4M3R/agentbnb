import { AvatarStack } from "@/components/ui/avatar";

/** Matches on marketplaces we can't book through: the agent drafts the message, the guest sends it there. */
export function ExternalMatches({
  count,
  sources,
  hosts,
  onShow,
}: {
  count: number;
  /** Marketplace names, e.g. ["Couchsurfing", "BeWelcome"]. */
  sources: string[];
  hosts: { name: string; photo?: string | null }[];
  onShow: () => void;
}) {
  const names = sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}` : sources[0];
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-hairline-soft px-4 py-3.5">
      <span className="shrink-0 max-sm:hidden">
        <AvatarStack people={hosts.slice(0, 3).map((h) => ({ name: h.name, src: h.photo }))} size={36} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">
          {count} more on {names}
        </span>
        <span className="text-sm text-muted">I&apos;ll draft each message. You send it on their site.</span>
      </span>
      <button
        type="button"
        onClick={onShow}
        className="h-9 shrink-0 rounded-[10px] border border-hairline px-3.5 text-sm font-semibold transition-colors hover:border-ink"
      >
        Show all
      </button>
    </div>
  );
}
