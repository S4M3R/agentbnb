"use client";

import { useRef } from "react";
import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { StayCard } from "./stay-card";
import type { StayCardData } from "./types";

/**
 * Stay cards in a snapping rail: one and a bit across in a narrow column, three across once the
 * column is 42rem wide. Scroll buttons appear when there are more than three.
 */
export function StayResults({
  stays,
  total,
  onOpen,
  saved,
  onToggleSave,
  onApply,
}: {
  stays: StayCardData[];
  /** Matches in all, when more were found than shown. */
  total?: number;
  onOpen: (stay: StayCardData) => void;
  saved?: Set<string>;
  onToggleSave?: (stay: StayCardData) => void;
  onApply?: (stay: StayCardData) => void;
}) {
  const rail = useRef<HTMLUListElement>(null);
  const scroll = (dir: 1 | -1) =>
    rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.9, behavior: "smooth" });

  if (stays.length === 0) {
    return <p className="rounded-card bg-surface-soft px-4 py-3 text-sm text-muted">No stays matched that search.</p>;
  }

  const more = stays.length > 3;

  return (
    <section aria-label="Stays found" className="@container flex flex-col gap-3">
      {(total != null || more) && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          {total != null && (
            <p className="text-sm text-muted">
              <span className="font-semibold text-ink">{total}</span> {total === 1 ? "stay" : "stays"} found
              {total > stays.length && ` · showing ${stays.length}`}
            </p>
          )}
          {more && (
            <div className="ml-auto flex gap-2 max-sm:hidden">
              <IconButton label="Scroll back" onClick={() => scroll(-1)} className="size-8">
                <ChevronLeftIcon size={16} />
              </IconButton>
              <IconButton label="Scroll forward" onClick={() => scroll(1)} className="size-8">
                <ChevronRightIcon size={16} />
              </IconButton>
            </div>
          )}
        </div>
      )}
      <ul
        ref={rail}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0 @2xl:gap-6"
      >
        {stays.map((s) => (
          <li key={s.id} className="w-[268px] shrink-0 snap-start @2xl:w-[calc((100%-3rem)/3)]">
            <StayCard
              stay={s}
              onOpen={() => onOpen(s)}
              saved={saved?.has(s.id)}
              onToggleSave={onToggleSave && (() => onToggleSave(s))}
              onApply={onApply && (() => onApply(s))}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
