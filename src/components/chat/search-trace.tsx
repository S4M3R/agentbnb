import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";

const TILE = ["bg-rausch", "bg-[#c2410c]", "bg-[#1f5f8b]", "bg-[#2f7d4f]"];

/**
 * What the agent did before answering, collapsed to one line ("Searched AgentBnB and 14
 * marketplaces"). Opens to the steps.
 */
export function SearchTrace({ summary, sources, steps }: { summary: string; sources: string[]; steps: string[] }) {
  return (
    <details className="group -ml-2.5 self-start">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-surface-strong hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="flex max-sm:hidden">
          {sources.slice(0, 4).map((s, i) => (
            <span
              key={s}
              className={`flex size-[22px] items-center justify-center rounded-md border-2 border-canvas text-[11px] font-extrabold text-white ${TILE[i % TILE.length]} ${i ? "-ml-1.5" : ""}`}
            >
              {s.slice(0, 1)}
            </span>
          ))}
        </span>
        <span>{summary}</span>
        <ChevronRightIcon size={14} strokeWidth={2.4} className="shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <ol className="ml-2.5 mt-2 flex flex-col gap-2 border-l border-hairline-soft pl-4">
        {steps.map((s) => (
          <li key={s} className="flex items-start gap-2 text-sm text-body">
            <CheckIcon size={15} strokeWidth={2.6} className="mt-0.5 shrink-0 text-success" />
            {s}
          </li>
        ))}
      </ol>
    </details>
  );
}
