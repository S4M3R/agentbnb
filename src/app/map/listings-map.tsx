"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { STAY_CATEGORIES, categoryOf, toMapStayCard, type StayCategory } from "@/components/stays/map-adapters";
import { StayCard } from "@/components/stays/stay-card";
import { StayPopupCard } from "@/components/stays/stay-popup-card";
import type { StayCardData } from "@/components/stays/types";
import { Button } from "@/components/ui/button";
import { MapIcon } from "@/components/ui/icons";
import type { MapListing } from "@/lib/map-listings";
import { CategoryStrip, type CategoryTab } from "./category-strip";
import { FiltersDialog, type SourceOption } from "./filters-dialog";
import { MapCanvas, type Bounds } from "./map-canvas";
import { FiltersIcon, ListIcon } from "./map-icons";
import { Couchbot } from "@/components/brand/logo";

/** Cards rendered per page of the list; the map still plots everything. */
const PAGE = 60;

type Category = StayCategory | "all";

/**
 * Airbnb's search results with a map: a grid of stay cards on the left that follows the map on
 * the right. Below 744px it's one or the other, switched by a floating "Map" / "List" pill.
 */
export function ListingsMap({ listings }: { listings: MapListing[] }) {
  const [category, setCategory] = useState<Category>("all");
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(() => new Set());
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const [phoneView, setPhoneView] = useState<"list" | "map">("list");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const phone = useIsPhone();
  const listRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const categories = useMemo(() => new Map(listings.map((l) => [l.id, categoryOf(l)])), [listings]);
  const cards = useMemo(() => new Map(listings.map((l) => [l.id, toMapStayCard(l)])), [listings]);

  // Only the kinds we actually have listings for get a tab.
  const tabs = useMemo<CategoryTab[]>(() => {
    const present = new Set(categories.values());
    return [
      { id: "all", label: "All" },
      ...STAY_CATEGORIES.filter((c) => present.has(c.id)).map((c) => ({ id: c.id, label: c.label })),
    ];
  }, [categories]);

  const inCategory = useMemo(
    () => (category === "all" ? listings : listings.filter((l) => categories.get(l.id) === category)),
    [listings, categories, category],
  );
  const shown = useMemo(
    () => (hiddenSources.size ? inCategory.filter((l) => !hiddenSources.has(l.sourceId)) : inCategory),
    [inCategory, hiddenSources],
  );

  // The list follows the map: what's inside the bounds, nearest the center first.
  const inBounds = useCallback(
    (l: MapListing) =>
      !bounds || (l.lng >= bounds.west && l.lng <= bounds.east && l.lat >= bounds.south && l.lat <= bounds.north),
    [bounds],
  );
  const visible = useMemo(() => {
    const list = shown.filter(inBounds);
    if (!bounds) return list;
    const cx = (bounds.west + bounds.east) / 2;
    const cy = (bounds.south + bounds.north) / 2;
    const d = (l: MapListing) => (l.lng - cx) ** 2 + (l.lat - cy) ** 2;
    return list.sort((a, b) => d(a) - d(b));
  }, [shown, inBounds, bounds]);

  // Marketplaces for the Filters modal: those with stays of this kind, counted in view.
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const options = new Map<string, SourceOption>();
    for (const l of inCategory) {
      const o = options.get(l.sourceId) ?? { id: l.sourceId, name: l.sourceName, count: 0 };
      if (inBounds(l)) o.count++;
      options.set(l.sourceId, o);
    }
    return [...options.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [inCategory, inBounds]);
  const hiddenHere = sourceOptions.filter((s) => hiddenSources.has(s.id)).length;

  // A page of cards per view; panning, zooming or filtering starts again from the top.
  const viewKey = `${category}|${[...hiddenSources].join(",")}|${bounds ? Object.values(bounds).join(",") : ""}`;
  const [pages, setPages] = useState({ key: viewKey, count: 1 });
  const pageCount = pages.key === viewKey ? pages.count : 1;
  const pageItems = useMemo(() => visible.slice(0, PAGE * pageCount), [visible, pageCount]);
  // Panning re-sorts the list; let the map keep its frame rate while the cards catch up.
  const page = useDeferredValue(pageItems);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [viewKey]);

  // A selection filtered out of view is dropped.
  const picked = selectedId ? byId.get(selectedId) : undefined;
  const selected =
    picked && (category === "all" || categories.get(picked.id) === category) && !hiddenSources.has(picked.sourceId)
      ? picked
      : null;

  const markVisited = useCallback((id: string) => {
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  /** Selecting another pin (or closing the card) leaves the last one gray, as on Airbnb. */
  const select = (id: string | null) => {
    if (selectedId && selectedId !== id) markVisited(selectedId);
    setSelectedId(id);
  };

  const changeCategory = (id: Category) => {
    setCategory(id);
    setSelectedId(null);
  };

  const card = selected ? (
    <StayPopupCard
      stay={cards.get(selected.id)!}
      note={selected.approximate ? "Approximate location" : null}
      cta={selected.url ? { href: selected.url, label: `View on ${selected.sourceName}`, onClick: () => markVisited(selected.id) } : undefined}
      onClose={() => select(null)}
      layout={phone ? "row" : "stack"}
    />
  ) : null;

  const count = visible.length;
  const heading = count > 1000 ? "Over 1,000 stays" : count === 0 ? "No stays in view" : `${count.toLocaleString()} ${count === 1 ? "stay" : "stays"} in view`;
  const sheetOpen = phone && phoneView === "map" && card;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Category strip and Filters, across the top as on Airbnb. */}
      <div className="relative z-20 flex shrink-0 items-center border-b border-hairline-soft bg-canvas pr-4 nav:pr-6">
        <CategoryStrip tabs={tabs} active={category} onChange={changeCategory} />
        <div className="pl-3 nav:pl-6">
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label={hiddenHere ? `Filters, ${hiddenHere} marketplaces hidden` : "Filters"}
            className="relative inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-hairline bg-canvas text-xs font-semibold text-ink transition-[border-color,box-shadow] hover:border-ink max-nav:w-10 max-nav:justify-center nav:rounded-xl nav:h-12 nav:px-4"
          >
            <FiltersIcon size={16} />
            <span className="max-nav:sr-only">Filters</span>
            {hiddenHere > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-white tabular-nums max-nav:absolute max-nav:-top-1 max-nav:-right-1">
                {hiddenHere}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* The list. On phones it covers the map, which stays mounted (and sized) underneath. */}
        <section
          ref={listRef}
          aria-label="Stays in the map area"
          className={`@container absolute inset-0 z-10 overflow-y-auto overscroll-contain bg-canvas nav:static nav:z-auto nav:w-[60%] nav:shrink-0 min-[1128px]:w-[58%] ${
            phoneView === "map" ? "max-nav:hidden" : ""
          }`}
        >
          <div className="px-4 pt-5 pb-28 nav:px-6 nav:pb-12">
            <h2 className="pb-5 text-base font-semibold tabular-nums">{heading}</h2>
            {count === 0 ? (
              <EmptyState
                filtered={hiddenSources.size > 0 || category !== "all"}
                onReset={() => {
                  setHiddenSources(new Set());
                  changeCategory("all");
                }}
              />
            ) : (
              <>
                <ListingGrid page={page} cards={cards} onHover={setHoveredId} onOpen={markVisited} />
                {count > page.length && (
                  <div className="flex flex-col items-center gap-3 pt-12">
                    <p className="text-sm text-muted tabular-nums">
                      Showing {page.length.toLocaleString()} of {count.toLocaleString()}
                    </p>
                    <Button variant="secondary" onClick={() => setPages({ key: viewKey, count: pageCount + 1 })}>
                      Show more stays
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* The map: full screen under the list on phones, the right-hand column from 744px. */}
        <div className="absolute inset-0 nav:static nav:min-w-0 nav:flex-1">
          <MapCanvas
            listings={shown}
            byId={byId}
            hoveredId={hoveredId}
            selectedId={selected?.id ?? null}
            visited={visited}
            popup={phone ? undefined : card}
            onBoundsChange={setBounds}
            onSelect={select}
          />
          {sheetOpen && (
            <div
              role="dialog"
              aria-label={selected?.title}
              className="absolute inset-x-0 bottom-0 z-20 rounded-t-[20px] bg-canvas px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-float transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] starting:translate-y-full motion-reduce:transition-none"
            >
              <div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-hairline" />
              {card}
            </div>
          )}
        </div>

        {/* Phones: the floating ink pill that swaps list and map. */}
        {!sheetOpen && (
          <button
            type="button"
            onClick={() => {
              setPhoneView((v) => (v === "list" ? "map" : "list"));
              setSelectedId(null);
            }}
            className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-30 inline-flex h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white shadow-float transition-transform active:scale-95 motion-reduce:transition-none nav:hidden"
          >
            {phoneView === "list" ? (
              <>
                Map <MapIcon size={16} />
              </>
            ) : (
              <>
                List <ListIcon size={16} />
              </>
            )}
          </button>
        )}
      </div>

      <FiltersDialog
        open={filtersOpen}
        sources={sourceOptions}
        hidden={hiddenSources}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setHiddenSources(next);
          setFiltersOpen(false);
          if (selected && next.has(selected.sourceId)) setSelectedId(null);
        }}
      />
    </div>
  );
}

/** The card grid, memoized so hovering a card (which re-renders the map) doesn't re-render the list. */
const ListingGrid = memo(function ListingGrid({
  page,
  cards,
  onHover,
  onOpen,
}: {
  page: MapListing[];
  cards: Map<string, StayCardData>;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-x-4 gap-y-8 @min-[28rem]:grid-cols-2 @min-[50rem]:grid-cols-3">
      {page.map((l) => (
        <li key={l.id}>
          <StayCard
            stay={cards.get(l.id)!}
            onOpen={() => onOpen(l.id)}
            onHoverChange={(on) => onHover(on ? l.id : null)}
          />
        </li>
      ))}
    </ul>
  );
});

function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border border-hairline-soft p-6">
      <div className="flex items-center gap-3.5">
        <Couchbot size={52} mood="sleepy" animated className="shrink-0" />
        <div>
          <p className="text-base font-semibold">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted">
            {filtered ? "Try zooming out, or show every kind of stay and marketplace." : "Try zooming out or moving the map."}
          </p>
        </div>
      </div>
      {filtered && (
        <Button variant="secondary" size="sm" onClick={onReset}>
          Remove filters
        </Button>
      )}
    </div>
  );
}

const PHONE_QUERY = "(max-width: 743.98px)";

/** Below DESIGN.md's 744px tablet breakpoint. False on the server. */
function useIsPhone() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(PHONE_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
