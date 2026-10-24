"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type MouseEvent } from "react";
import { isActive, type NavTab } from "./nav";

type TabsProps = {
  tabs: NavTab[];
  /** `row`: icon beside the label, for the desktop header. `stacked`: icon over the label, for phones. */
  layout?: "row" | "stacked";
  className?: string;
};

/**
 * The header's product tabs: a 3D icon with each label, ink and underlined when active.
 * A clicked tab lights up straight away, before its page has loaded.
 */
export function CategoryTabs({ tabs, layout = "row", className = "" }: TabsProps) {
  const [selected, select] = useState<string | null>(null);
  // Next keeps a page mounted but hidden once you leave it, and Back shows it again. Its effects
  // clean up on the way out, so the tab clicked to leave isn't still lit when you come back.
  useEffect(() => () => select(null), []);
  const props = { tabs, layout, selected, onSelect: select };
  return (
    <nav aria-label="Main" className={className}>
      {/* The current path is request data; the tabs render unhighlighted until it's known. */}
      <Suspense fallback={<TabList {...props} />}>
        <ActiveTabs {...props} />
      </Suspense>
    </nav>
  );
}

type ListProps = {
  tabs: NavTab[];
  layout: "row" | "stacked";
  /** The tab clicked last, shown as active while its page loads. */
  selected: string | null;
  onSelect: (href: string) => void;
  pathname?: string;
};

function ActiveTabs(props: Omit<ListProps, "pathname">) {
  return <TabList {...props} pathname={usePathname()} />;
}

function TabList({ tabs, layout, selected, onSelect, pathname }: ListProps) {
  const Tab = layout === "row" ? RowTab : StackedTab;
  return (
    <ul className={layout === "row" ? "flex items-stretch gap-1 lg:gap-2" : "grid grid-cols-4"}>
      {tabs.map((tab) => {
        const active = selected ? selected === tab.href : isActive(tab.href, pathname);
        const onClick = (e: MouseEvent) => {
          // A new-tab click leaves this page where it is.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          if (!isActive(tab.href, pathname)) onSelect(tab.href);
        };
        return (
          <li key={tab.href} className="flex">
            <Tab tab={tab} active={active} onClick={onClick} />
          </li>
        );
      })}
    </ul>
  );
}

type TabProps = { tab: NavTab; active: boolean; onClick: (e: MouseEvent) => void };

function RowTab({ tab, active, onClick }: TabProps) {
  return (
    <Link
      href={tab.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group relative flex h-14 items-center gap-1.5 rounded-xl px-2 text-[15px] font-semibold transition-colors duration-200 lg:gap-2 lg:px-3 lg:text-base ${active ? "text-ink" : "text-muted hover:text-ink"}`}
    >
      <TabIcon tab={tab} active={active} size={44} />
      <span className="whitespace-nowrap">{tab.label}</span>
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-ink motion-safe:animate-underline-in lg:inset-x-3"
        />
      )}
    </Link>
  );
}

function StackedTab({ tab, active, onClick }: TabProps) {
  return (
    <Link
      href={tab.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group relative flex w-full flex-col items-center gap-1 pb-2.5 pt-1 text-xs font-semibold leading-tight transition-colors ${active ? "text-ink" : "text-muted"}`}
    >
      <TabIcon tab={tab} active={active} size={34} />
      <span className="whitespace-nowrap">{tab.label}</span>
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink motion-safe:animate-underline-in"
        />
      )}
    </Link>
  );
}

/**
 * The tab's clay icon. It lifts and tilts on hover, dips on press and springs into place when its
 * tab becomes active. Reduced motion keeps it still.
 */
function TabIcon({ tab, active, size }: { tab: NavTab; active: boolean; size: number }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {/* The pop and the hover sit on separate elements so one never cancels the other. */}
      <span className={`block size-full ${active ? "motion-safe:animate-tab-pop" : ""}`}>
        <Image
          src={tab.icon}
          alt=""
          width={size}
          height={size}
          unoptimized
          loading="eager"
          draggable={false}
          className={`size-full select-none object-contain transition-[translate,scale,rotate,filter] duration-500 ease-spring motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:-rotate-3 motion-safe:group-hover:scale-110 motion-safe:group-active:scale-95 motion-safe:group-active:duration-150 ${active ? "" : "saturate-[0.85]"}`}
        />
      </span>
      {tab.count != null && (
        <span className="absolute -right-1 -top-0.5 min-w-[18px] rounded-full border-2 border-canvas bg-rausch px-1 text-center text-[10px] font-bold leading-[14px] text-white tabular-nums">
          {tab.count}
          <span className="sr-only"> unread</span>
        </span>
      )}
      {tab.isNew && tab.count == null && (
        <span className="absolute -right-3 -top-1 rounded-full bg-canvas px-1.5 py-0.5 text-[8px] font-bold uppercase leading-[10px] tracking-[0.32px] text-ink shadow-float">
          New
        </span>
      )}
    </span>
  );
}
