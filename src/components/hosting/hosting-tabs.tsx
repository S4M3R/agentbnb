import Link from "next/link";

const TABS = [
  { id: "listings", label: "Listings", href: "/hosting" },
  { id: "requests", label: "Requests", href: "/requests" },
] as const;

export type HostingTab = (typeof TABS)[number]["id"];

/** The Hosting section's sub-nav, Airbnb's host-dashboard style: text tabs, ink underline on the current one. */
export function HostingTabs({ active, counts }: { active: HostingTab; counts?: Partial<Record<HostingTab, number>> }) {
  return (
    <nav aria-label="Hosting" className="mb-6 border-b border-hairline-soft nav:mb-8">
      <ul className="-mb-px flex gap-6">
        {TABS.map((tab) => {
          const current = tab.id === active;
          const count = counts?.[tab.id];
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`relative inline-flex h-12 items-center gap-1.5 text-[15px] font-semibold transition-colors ${
                  current ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {tab.label}
                {count != null && count > 0 && (
                  <span className="min-w-5 rounded-full bg-surface-strong px-1.5 text-center text-xs leading-5 tabular-nums text-ink">
                    {count}
                  </span>
                )}
                {current && (
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-ink" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
