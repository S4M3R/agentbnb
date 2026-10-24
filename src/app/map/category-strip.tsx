"use client";

import { useEffect, useRef } from "react";
import type { StayCategory } from "@/components/stays/map-adapters";
import { CategoryIcon } from "./map-icons";

export type CategoryTab = { id: StayCategory | "all"; label: string };

/**
 * Airbnb's category strip: an icon over each label, muted until active, then ink with a 2px
 * underline. Scrolls sideways when it doesn't fit; the active tab scrolls into view.
 */
export function CategoryStrip({
  tabs,
  active,
  onChange,
}: {
  tabs: CategoryTab[];
  active: CategoryTab["id"];
  onChange: (id: CategoryTab["id"]) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Kinds of stay"
      className="no-scrollbar flex min-w-0 flex-1 gap-6 overflow-x-auto px-4 nav:gap-8 nav:px-6"
    >
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={`group relative flex shrink-0 flex-col items-center gap-1.5 pt-3 pb-3 text-xs font-semibold transition-colors ${
              on ? "text-ink" : "text-muted hover:text-ink"
            }`}
          >
            <CategoryIcon
              category={tab.id}
              size={24}
              className={`transition-opacity ${on ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`}
            />
            <span className="whitespace-nowrap">{tab.label}</span>
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full transition-colors ${
                on ? "animate-underline-in bg-ink motion-reduce:animate-none" : "bg-transparent group-hover:bg-hairline"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
