"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, Marker, PositionAnchor } from "maplibre-gl";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { pinLabel } from "@/components/stays/map-adapters";
import type { MapListing } from "@/lib/map-listings";
import { MARKETS } from "@/lib/markets";

/*
 * Marker classes. Markers are plain DOM elements MapLibre positions outside React, so their states
 * are data attributes on the wrapper (`data-state`, `data-active`) styled through `group-data-*`.
 * MapLibre sets `transform` on the wrapper itself, so the pill inside is what scales.
 */
const MARKER = "group cursor-pointer data-active:z-[2]";
const EASE = "transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none";
const PILL = `block whitespace-nowrap rounded-full bg-canvas px-2.5 py-1.5 text-sm leading-4 font-semibold tabular-nums text-ink shadow-float ${EASE} hover:scale-[1.077] hover:bg-ink hover:text-white group-data-[state=hover]:scale-[1.077] group-data-[state=hover]:bg-ink group-data-[state=hover]:text-white group-data-[state=selected]:bg-ink group-data-[state=selected]:text-white group-data-[state=visited]:bg-surface-strong group-data-[state=visited]:text-body motion-reduce:hover:scale-100 motion-reduce:group-data-[state=hover]:scale-100`;
const CLUSTER = `flex items-center justify-center rounded-full bg-canvas text-[13px] font-bold tabular-nums text-ink shadow-float ${EASE} hover:scale-[1.06] hover:bg-ink hover:text-white motion-reduce:hover:scale-100`;
/** Above every pin; `%` is of the map, the marker's containing block. Matches POPUP_WIDTH. */
const POPUP = "z-[5] w-[min(327px,calc(100%-24px))] cursor-auto";
/** Airbnb-style zoom buttons: a white rounded square with the one shadow tier. MapLibre's CSS is unlayered, hence `!`. */
const CONTROLS =
  "[&_.maplibregl-ctrl-group]:overflow-hidden [&_.maplibregl-ctrl-group]:rounded-lg! [&_.maplibregl-ctrl-group]:shadow-float! [&_.maplibregl-ctrl-group_button]:size-9!";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/**
 * Positron is already light and gray; these tint water and parks toward Airbnb's map, soft blue
 * and soft green. MapLibre paints them, so they're colors here rather than CSS tokens.
 */
const WATER = "#cfe5f3";
const PARK = "#e4efdc";

/** Pins cluster up to this zoom; one step past it, every listing has its own price pill. */
const CLUSTER_MAX_ZOOM = 15;
/** Wide enough that neighboring pills rarely overlap. */
const CLUSTER_RADIUS = 56;

/** The floating card's footprint, for keeping it on screen next to its pin. */
const POPUP_WIDTH = 327;
const POPUP_HEIGHT = 360;
const POPUP_GAP = 22;

export type Bounds = { west: number; south: number; east: number; north: number };

type Entry = { marker: Marker; el: HTMLElement; id?: string };

/**
 * The MapLibre map with Airbnb-style price pills. The listings are a clustered GeoJSON source
 * (clustering runs in MapLibre's worker); only what's on screen becomes DOM: one HTML marker per
 * cluster or unclustered listing in the loaded tiles, a few dozen to a couple hundred at a time,
 * diffed on every render frame. The hovered and selected listing always get a pill, even when
 * they'd otherwise be inside a cluster.
 */
export function MapCanvas({
  listings,
  byId,
  hoveredId,
  selectedId,
  visited,
  popup,
  onBoundsChange,
  onSelect,
}: {
  /** What to plot (already filtered). */
  listings: MapListing[];
  /** Every listing by id, for labels and positions. */
  byId: Map<string, MapListing>;
  hoveredId: string | null;
  selectedId: string | null;
  visited: Set<string>;
  /** The card to float beside the selected pin, if any. */
  popup?: ReactNode;
  onBoundsChange: (bounds: Bounds) => void;
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, Entry>());
  const syncRef = useRef<() => void>(() => {});
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  /** Bumped on every setData: cluster ids are only meaningful within one dataset. */
  const generationRef = useRef(0);
  // Next hides this page (and tears the map down) when you navigate away; come back to the same view.
  const cameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [popupEl, setPopupEl] = useState<HTMLElement | null>(null);

  // Everything the map's own event handlers read, kept current without re-creating the map.
  const live = useRef({ listings, byId, hoveredId, selectedId, visited });
  useEffect(() => {
    live.current = { listings, byId, hoveredId, selectedId, visited };
  });

  const select = useEffectEvent((id: string | null) => onSelect(id));
  const reportBounds = useEffectEvent((b: Bounds) => onBoundsChange(b));

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    const markers = markersRef.current;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      // MapLibre looks for its worker next to its own module, which doesn't survive
      // bundling. Ship the (self-contained) worker as a static asset instead.
      maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
      libRef.current = maplibregl;

      const camera = cameraRef.current;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        ...(camera ? { center: camera.center, zoom: camera.zoom } : { bounds: initialBounds(live.current.listings) }),
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;
      const m = map;

      const stateOf = (id: string) => {
        const s = live.current;
        if (id === s.hoveredId) return "hover";
        if (id === s.selectedId) return "selected";
        if (s.visited.has(id)) return "visited";
        return null;
      };
      const paint = (entry: Entry) => {
        if (!entry.id) return;
        const state = stateOf(entry.id);
        if (state) entry.el.dataset.state = state;
        else delete entry.el.dataset.state;
        entry.el.toggleAttribute("data-active", state === "hover" || state === "selected");
      };

      const makePin = (l: MapListing): Entry => {
        const el = document.createElement("div");
        el.className = MARKER;
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = PILL;
        const label = pinLabel(l);
        pill.textContent = label;
        pill.setAttribute("aria-label", `${label}: ${l.title}`);
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          select(l.id);
        });
        el.append(pill);
        const entry = { el, id: l.id, marker: new maplibregl.Marker({ element: el }).setLngLat([l.lng, l.lat]).addTo(m) };
        paint(entry);
        return entry;
      };

      const makeCluster = (clusterId: number, count: number, at: [number, number]): Entry => {
        const el = document.createElement("div");
        el.className = MARKER;
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = CLUSTER;
        const size = count < 10 ? 32 : count < 50 ? 38 : count < 200 ? 44 : 50;
        dot.style.width = dot.style.height = `${size}px`;
        dot.textContent = count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count);
        dot.setAttribute("aria-label", `${count} stays here. Zoom in`);
        dot.addEventListener("click", async (e) => {
          e.stopPropagation();
          const source = m.getSource<GeoJSONSource>("listings");
          if (!source) return;
          const zoom = await source.getClusterExpansionZoom(clusterId);
          m.easeTo({ center: at, zoom: Math.min(zoom, CLUSTER_MAX_ZOOM + 1) });
        });
        el.append(dot);
        return { el, marker: new maplibregl.Marker({ element: el }).setLngLat(at).addTo(m) };
      };

      // Diff the clusters and pins in the loaded tiles against the markers on the map.
      const sync = () => {
        if (!m.getSource("listings") || !m.isSourceLoaded("listings")) return;
        const { byId: all, hoveredId: hovered, selectedId: picked } = live.current;
        const seen = new Set<string>();
        for (const f of m.querySourceFeatures("listings")) {
          const p = f.properties;
          if (p.cluster) {
            const key = `c${generationRef.current}:${p.cluster_id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!markers.has(key)) {
              markers.set(key, makeCluster(p.cluster_id, p.point_count, (f.geometry as Point).coordinates as [number, number]));
            }
          } else {
            const key = `p:${p.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const l = all.get(p.id);
            if (l && !markers.has(key)) markers.set(key, makePin(l));
          }
        }
        for (const id of [hovered, picked]) {
          const l = id ? all.get(id) : undefined;
          if (!l) continue;
          seen.add(`p:${l.id}`);
          if (!markers.has(`p:${l.id}`)) markers.set(`p:${l.id}`, makePin(l));
        }
        for (const [key, entry] of markers) {
          if (!seen.has(key)) {
            entry.marker.remove();
            markers.delete(key);
          }
        }
      };
      syncRef.current = () => {
        for (const entry of markers.values()) paint(entry);
        sync();
      };

      const updateBounds = () => {
        const b = m.getBounds();
        const c = m.getCenter();
        cameraRef.current = { center: [c.lng, c.lat], zoom: m.getZoom() };
        reportBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      };

      m.on("load", () => {
        tintStyle(m);
        m.addSource("listings", {
          type: "geojson",
          data: toFeatureCollection(live.current.listings),
          cluster: true,
          clusterRadius: CLUSTER_RADIUS,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
        });
        // Invisible: it only makes MapLibre load (and cluster) the source's tiles for `sync` to read.
        m.addLayer({
          id: "listings-index",
          type: "circle",
          source: "listings",
          paint: { "circle-radius": 1, "circle-opacity": 0, "circle-stroke-opacity": 0 },
        });

        m.on("render", sync);
        m.on("click", () => select(null));
        m.on("moveend", updateBounds);

        updateBounds();
        setReady(true);
      });

      const el = document.createElement("div");
      el.className = POPUP;
      // Clicks, drags and scrolls on the card stay on the card.
      for (const type of ["mousedown", "touchstart", "wheel", "dblclick", "click", "pointerdown"]) {
        el.addEventListener(type, (e) => e.stopPropagation());
      }
      setPopupEl(el);
    })();

    return () => {
      cancelled = true;
      for (const entry of markers.values()) entry.marker.remove();
      markers.clear();
      map?.remove();
      mapRef.current = null;
      syncRef.current = () => {};
      setReady(false);
      setPopupEl(null);
    };
    // The map is created once; data and state flow in through the effects below.
  }, []);

  // Push the (filtered) listings into the clustered source.
  useEffect(() => {
    if (!ready) return;
    generationRef.current++;
    mapRef.current?.getSource<GeoJSONSource>("listings")?.setData(toFeatureCollection(listings));
  }, [ready, listings]);

  // Restyle pins when the hovered, selected or visited ones change.
  useEffect(() => {
    if (ready) syncRef.current();
  }, [ready, hoveredId, selectedId, visited]);

  // Float the card beside the selected pin, on whichever side keeps it on screen.
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const showPopup = Boolean(ready && popup && selected && popupEl);
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !popupEl || !showPopup || !selected) return;
    const at: [number, number] = [selected.lng, selected.lat];
    const { anchor, offset } = placePopup(map, at);
    // A marker's anchor is fixed when it's made, so each selection gets a fresh one around the same element.
    const marker = new lib.Marker({ element: popupEl, anchor, offset }).setLngLat(at).addTo(map);
    return () => {
      marker.remove();
    };
  }, [showPopup, selected, popupEl]);

  return (
    <div className={`${CONTROLS} relative size-full`}>
      <div ref={containerRef} className="size-full bg-surface-soft" />
      {showPopup && popupEl && createPortal(popup, popupEl)}
    </div>
  );
}

function popupWidth(map: MapLibreMap) {
  return Math.min(POPUP_WIDTH, map.getContainer().clientWidth - 24);
}

/** Above the pin if there's room, else below, else beside it; nudged sideways to stay inside the map. */
function placePopup(map: MapLibreMap, at: [number, number]): { anchor: PositionAnchor; offset: [number, number] } {
  const { clientWidth: W, clientHeight: H } = map.getContainer();
  const p = map.project(at);
  const w = popupWidth(map);
  const h = Math.min(POPUP_HEIGHT, H - 16);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  const dx = clamp(0, 8 + w / 2 - p.x, W - 8 - w / 2 - p.x);
  if (p.y - POPUP_GAP - h >= 8) return { anchor: "bottom", offset: [dx, -POPUP_GAP] };
  if (H - p.y - POPUP_GAP - h >= 8) return { anchor: "top", offset: [dx, POPUP_GAP] };

  const dy = clamp(0, 8 + h / 2 - p.y, H - 8 - h / 2 - p.y);
  return p.x > W / 2
    ? { anchor: "right", offset: [-POPUP_GAP - 24, dy] }
    : { anchor: "left", offset: [POPUP_GAP + 24, dy] };
}

function tintStyle(map: MapLibreMap) {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "fill") continue;
    if (/water/.test(layer.id)) map.setPaintProperty(layer.id, "fill-color", WATER);
    else if (/park|wood|forest|grass|landcover/.test(layer.id)) map.setPaintProperty(layer.id, "fill-color", PARK);
  }
}

function toFeatureCollection(listings: MapListing[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: listings.map((l) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [l.lng, l.lat] },
      properties: { id: l.id },
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
