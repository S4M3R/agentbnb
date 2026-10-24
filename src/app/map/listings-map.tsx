"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapListing } from "@/lib/map-listings";
import { MARKETS } from "@/lib/markets";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

const SOURCE_COLORS: Record<string, string> = {
  internal: "#e11d48",
  trustedhousesitters: "#0d9488",
  workaway: "#ea580c",
  worldpackers: "#7c3aed",
};
const FALLBACK_COLOR = "#475569";

const TYPE_LABELS: Record<string, string> = {
  couch: "Couch",
  private_room: "Private room",
  shared_room: "Shared room",
  entire_place: "Entire place",
  house_sit: "House sit",
  work_exchange: "Work exchange",
  farm_stay: "Farm stay",
};

/** Max list rows rendered at once; the map still shows everything. */
const LIST_LIMIT = 150;

type Bounds = { west: number; south: number; east: number; north: number };

const colorFor = (sourceId: string) => SOURCE_COLORS[sourceId] ?? FALLBACK_COLOR;

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`));

export function ListingsMap({ listings }: { listings: MapListing[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const sources = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const l of listings) {
      const s = counts.get(l.sourceId) ?? { id: l.sourceId, name: l.sourceName, count: 0 };
      s.count++;
      counts.set(l.sourceId, s);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [listings]);

  const [hiddenSources, setHiddenSources] = useState<Set<string>>(() => new Set());

  const shown = useMemo(
    () => listings.filter((l) => !hiddenSources.has(l.sourceId)),
    [listings, hiddenSources],
  );

  const byId = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const selectedListing = selectedId ? byId.get(selectedId) : undefined;
  // Hiding a source also dismisses a selected listing from it.
  const selected = selectedListing && !hiddenSources.has(selectedListing.sourceId) ? selectedListing : null;

  // Listings inside the current viewport, nearest to the map center first.
  const visible = useMemo(() => {
    if (!bounds) return shown;
    const cx = (bounds.west + bounds.east) / 2;
    const cy = (bounds.south + bounds.north) / 2;
    return shown
      .filter((l) => l.lng >= bounds.west && l.lng <= bounds.east && l.lat >= bounds.south && l.lat <= bounds.north)
      .sort((a, b) => (a.lng - cx) ** 2 + (a.lat - cy) ** 2 - ((b.lng - cx) ** 2 + (b.lat - cy) ** 2));
  }, [shown, bounds]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      // MapLibre looks for its worker next to its own module, which doesn't survive
      // bundling. Ship the (self-contained) worker as a static asset instead.
      maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        bounds: initialBounds(listings),
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;

      const updateBounds = () => {
        const b = map!.getBounds();
        setBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      };

      map.on("load", () => {
        const m = map!;
        m.addSource("listings", {
          type: "geojson",
          data: toFeatureCollection([]),
          cluster: true,
          clusterRadius: 44,
          clusterMaxZoom: 14,
        });

        m.addLayer({
          id: "clusters",
          type: "circle",
          source: "listings",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#18181b",
            "circle-opacity": 0.88,
            "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 23, 150, 29],
            "circle-stroke-width": 3,
            "circle-stroke-color": "rgba(255,255,255,0.9)",
          },
        });
        m.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "listings",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        });
        m.addLayer({
          id: "points",
          type: "circle",
          source: "listings",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4.5, 14, 7],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        m.addLayer({
          id: "points-highlight",
          type: "circle",
          source: "listings",
          filter: ["in", ["get", "id"], ["literal", []]],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": 10,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });

        m.on("click", "clusters", async (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const source = m.getSource<GeoJSONSource>("listings")!;
          const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
          m.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom });
        });
        m.on("click", "points", (e) => {
          const id = e.features?.[0]?.properties.id;
          if (id) setSelectedId(id);
        });
        m.on("click", (e) => {
          const hits = m.queryRenderedFeatures(e.point, { layers: ["points", "clusters"] });
          if (!hits.length) setSelectedId(null);
        });
        for (const layer of ["clusters", "points"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
        m.on("mousemove", "points", (e) => setHoveredId(e.features?.[0]?.properties.id ?? null));
        m.on("mouseleave", "points", () => setHoveredId(null));
        m.on("moveend", updateBounds);

        updateBounds();
        setMapReady(true);
      });
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // The map is created once; data updates flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push the (filtered) listings into the clustered source.
  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.getSource<GeoJSONSource>("listings")?.setData(toFeatureCollection(shown));
  }, [mapReady, shown]);

  // Highlight the hovered and selected pins.
  useEffect(() => {
    if (!mapReady) return;
    const ids = [selectedId, hoveredId].filter(Boolean);
    mapRef.current?.setFilter("points-highlight", ["in", ["get", "id"], ["literal", ids]]);
  }, [mapReady, selectedId, hoveredId]);

  // Keep the selected row in view when a pin is clicked.
  useEffect(() => {
    if (selectedId) document.getElementById(`listing-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const focus = (l: MapListing) => {
    setSelectedId(l.id);
    const map = mapRef.current;
    if (!map) return;
    // Land the pin clear of the listing card: it sits along the bottom on small
    // screens and on the left (320px wide) from `sm` up.
    const { clientWidth, clientHeight } = map.getContainer();
    const offset: [number, number] = clientWidth < 640 ? [0, -clientHeight / 4] : [172, 0];
    map.flyTo({ center: [l.lng, l.lat], zoom: Math.max(map.getZoom(), 15), speed: 1.6, offset });
  };

  const toggleSource = (id: string) =>
    setHiddenSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="order-2 flex min-h-0 flex-1 flex-col border-zinc-200 md:order-1 md:w-96 md:flex-none md:border-r">
        <header className="space-y-3 border-b border-zinc-200 px-4 pt-4 pb-3">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-lg font-semibold tracking-tight">AgentBnB</h1>
            <p className="text-sm text-zinc-500 tabular-nums">
              {visible.length.toLocaleString()} of {shown.length.toLocaleString()} in view
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => {
              const on = !hiddenSources.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSource(s.id)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    on
                      ? "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
                      : "border-zinc-200 bg-zinc-100 text-zinc-400 hover:text-zinc-600"
                  }`}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: on ? colorFor(s.id) : "#d4d4d8" }}
                  />
                  {s.name}
                  <span className="tabular-nums text-zinc-400">{s.count}</span>
                </button>
              );
            })}
          </div>
        </header>

        <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto">
          {visible.slice(0, LIST_LIMIT).map((l) => (
            <li key={l.id} id={`listing-${l.id}`}>
              <button
                type="button"
                onClick={() => focus(l)}
                onMouseEnter={() => setHoveredId(l.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 ${
                  l.id === selectedId ? "bg-zinc-100 hover:bg-zinc-100" : ""
                }`}
              >
                <Thumb src={l.photo} className="size-16 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{l.title}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {[l.place, TYPE_LABELS[l.type] ?? l.type].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: colorFor(l.sourceId) }} />
                    {l.sourceName}
                    {l.nextAvailable && (
                      <span className="text-zinc-400">
                        · from {formatDate(l.nextAvailable.start)}
                      </span>
                    )}
                  </p>
                </div>
              </button>
            </li>
          ))}
          {visible.length > LIST_LIMIT && (
            <li className="px-4 py-4 text-center text-xs text-zinc-500">
              {(visible.length - LIST_LIMIT).toLocaleString()} more in this area. Zoom in to narrow it down.
            </li>
          )}
          {visible.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-zinc-500">
              No listings in this area. Zoom out or turn on more sources.
            </li>
          )}
        </ul>
      </aside>

      <div className="relative order-1 h-[50dvh] md:order-2 md:h-auto md:flex-1">
        <div ref={containerRef} className="h-full w-full bg-zinc-100" />
        {selected && <ListingCard listing={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

function ListingCard({ listing: l, onClose }: { listing: MapListing; onClose: () => void }) {
  return (
    <article className="absolute inset-x-3 bottom-3 z-10 flex overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5 sm:inset-x-auto sm:left-3 sm:w-80 sm:flex-col">
      <Thumb src={l.photo} className="w-24 shrink-0 sm:aspect-[16/9] sm:w-full" />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-white/90 text-zinc-700 shadow-sm hover:bg-white"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
      <div className="min-w-0 flex-1 space-y-1.5 p-3 pr-10 sm:space-y-2 sm:p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
          <span className="size-2 rounded-full" style={{ backgroundColor: colorFor(l.sourceId) }} />
          {l.sourceName} · {TYPE_LABELS[l.type] ?? l.type}
          {l.rating != null && <span className="text-zinc-400">· ★ {l.rating.toFixed(1)}</span>}
        </p>
        <h2 className="line-clamp-2 text-sm font-semibold leading-snug sm:text-base">{l.title}</h2>
        <dl className="space-y-1 text-xs text-zinc-600 sm:text-sm">
          {l.place && (
            <div>
              <dt className="sr-only">Location</dt>
              <dd>
                {l.place}
                {l.approximate && <span className="text-zinc-400"> · approximate location</span>}
              </dd>
            </div>
          )}
          {l.summary && (
            <div className="hidden sm:block">
              <dt className="sr-only">What it involves</dt>
              <dd>{l.summary}</dd>
            </div>
          )}
          {l.nextAvailable && (
            <div>
              <dt className="sr-only">Next available</dt>
              <dd>
                Open {formatDate(l.nextAvailable.start)} – {formatDate(l.nextAvailable.end)}
              </dd>
            </div>
          )}
        </dl>
        {l.url && (
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex w-full items-center justify-center rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 sm:py-2 sm:text-sm"
          >
            View on {l.sourceName}
          </a>
        )}
      </div>
    </article>
  );
}

function Thumb({ src, className }: { src: string | null; className: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <div className={`${className} bg-zinc-100`} />;
  return (
    // Photos are hotlinked from each marketplace's CDN, so skip next/image's domain allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className={`${className} bg-zinc-100 object-cover`}
    />
  );
}

function toFeatureCollection(listings: MapListing[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: listings.map((l) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [l.lng, l.lat] },
      properties: { id: l.id, color: colorFor(l.sourceId) },
    })),
  };
}

/** Open on the launch market (SF Bay Area); fall back to fitting every listing. */
function initialBounds(listings: MapListing[]): [number, number, number, number] | undefined {
  const market = MARKETS[0]?.bounds;
  if (market) return [market.west, market.south, market.east, market.north];
  if (!listings.length) return undefined;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of listings) {
    w = Math.min(w, l.lng);
    s = Math.min(s, l.lat);
    e = Math.max(e, l.lng);
    n = Math.max(n, l.lat);
  }
  return [w, s, e, n];
}
