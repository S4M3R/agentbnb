import { Fragment } from "react";
import { AvatarStack } from "@/components/ui/avatar";
import { SiteName } from "@/components/ui/site-name";

/** A marketplace by name, or with its source id (or URL) too so its favicon shows. */
type Source = string | { id: string; name: string };

/** Matches on marketplaces we can't book through: the agent drafts the message, the guest sends it there. */
export function ExternalMatches({
  count,
  sources,
  hosts,
  onShow,
}: {
  count: number;
  /** Marketplaces, e.g. ["Couchsurfing", "BeWelcome"] or [{ id: "couchsurfing", name: "Couchsurfing" }]. */
  sources: Source[];
  hosts: { name: string; photo?: string | null }[];
  onShow: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-hairline-soft px-4 py-3.5">
      <span className="shrink-0 max-sm:hidden">
        <AvatarStack people={hosts.slice(0, 3).map((h) => ({ name: h.name, src: h.photo }))} size={36} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">
          {count} more on{" "}
          {sources.map((s, i) => (
            <Fragment key={typeof s === "string" ? s : s.id}>
              {i > 0 && (i === sources.length - 1 ? " and " : ", ")}
              {typeof s === "string" ? s : <SiteName site={s.id}>{s.name}</SiteName>}
            </Fragment>
          ))}
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
