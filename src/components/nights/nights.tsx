import { MoonIcon } from "@/components/ui/icons";

/** Nights are the currency: hosting one night earns one, staying one spends one. */
export type NightsSummary = {
  balance: number;
  /** Nights earned from stays you have agreed to host but that have not happened yet. */
  pending?: number;
  /** One line on what changes the balance next, e.g. "Hosting Lena on 6–8 Nov earns 2." */
  note?: string;
};

const plural = (n: number) => `${n} ${n === 1 ? "night" : "nights"}`;

/** Compact balance for a header. */
export function NightsPill({ balance }: { balance: number }) {
  return (
    <span
      aria-label={`${plural(balance)} to spend`}
      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-hairline px-3.5 text-sm font-semibold tabular-nums text-ink"
    >
      <MoonIcon size={15} className="text-rausch" />
      {plural(balance)}
    </span>
  );
}

/** Balance with a bar of spent-vs-pending nights, for the sidebar. */
export function NightsCard({ nights }: { nights: NightsSummary }) {
  const pending = nights.pending ?? 0;
  const segments = [
    ...Array.from({ length: nights.balance }, () => "bg-rausch"),
    ...Array.from({ length: pending }, () => "bg-rausch-disabled"),
  ].slice(0, 14);

  return (
    <section aria-label="Your nights" className="rounded-[14px] border border-hairline-soft bg-canvas px-3.5 py-3">
      <div className="flex items-center justify-between text-[13px] font-semibold">
        <span className="text-muted">Your nights</span>
        {pending > 0 && <span className="text-success">+{pending} pending</span>}
      </div>
      <p className="mt-0.5 flex items-center gap-1.5">
        <MoonIcon size={18} className="text-rausch" />
        <span className="text-[26px] font-extrabold leading-8 tracking-[-0.03em] tabular-nums">{nights.balance}</span>
        <span className="text-[13px] text-body">{nights.balance === 1 ? "night" : "nights"} to spend</span>
      </p>
      {segments.length > 0 && (
        <div aria-hidden="true" className="mt-2 flex gap-[3px]">
          {segments.map((tone, i) => (
            <span key={i} className={`h-[5px] flex-1 rounded-full ${tone}`} />
          ))}
        </div>
      )}
      {nights.note && <p className="mt-2 text-xs leading-4 text-muted">{nights.note}</p>}
    </section>
  );
}
