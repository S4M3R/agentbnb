import { CloseIcon, PlusIcon } from "@/components/ui/icons";

/** What the agent is matching on, each removable, plus suggestions to narrow further. */
export function MatchFilters({
  filters,
  suggestions = [],
  onRemove,
  onAdd,
}: {
  filters: string[];
  suggestions?: string[];
  onRemove: (filter: string) => void;
  onAdd: (suggestion: string) => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      <span className="mr-0.5 shrink-0 text-[13px] font-semibold text-muted max-sm:hidden">Matching on</span>
      {filters.map((f) => (
        <span
          key={f}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-ink pl-3 pr-1 text-[13px] font-semibold"
        >
          {f}
          <button
            type="button"
            onClick={() => onRemove(f)}
            aria-label={`Stop matching on ${f}`}
            className="flex size-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-strong hover:text-ink"
          >
            <CloseIcon size={13} strokeWidth={2.4} />
          </button>
        </span>
      ))}
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onAdd(s)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border-strong pl-2.5 pr-3 text-[13px] font-medium text-body transition-colors hover:border-ink hover:text-ink"
        >
          <PlusIcon size={14} strokeWidth={2.4} />
          {s}
        </button>
      ))}
    </div>
  );
}
