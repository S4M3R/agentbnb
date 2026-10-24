"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PinIcon, SearchIcon } from "@/components/ui/icons";

// The askForLocation tool in the chat: share your current location or drop a pin on the map
// (with place search). Returns the point and a short place name to the agent.

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const DEFAULT_VIEW = { center: [-122.42, 37.77] as [number, number], zoom: 10 }; // SF Bay Area

type Point = { lat: number; lng: number };
type Place = Point & { label: string; short: string };
export type LocationRequestInput = { intro: string };
export type LocationRequestOutput = { point: Point; label: string; address: string; source: "gps" | "map" };

async function geocode(params: Record<string, string>): Promise<Place[]> {
  const res = await fetch(`/api/hosting/geocode?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error("lookup failed");
  return (await res.json()).places;
}

export function LocationRequest({
  input,
  done,
  disabled = false,
  onDone,
}: {
  input: LocationRequestInput;
  done?: LocationRequestOutput;
  disabled?: boolean;
  onDone?: (output: LocationRequestOutput) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [source, setSource] = useState<"gps" | "map">("map");
  const [place, setPlace] = useState<Place | null>(null);
  const [naming, setNaming] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const interactive = !done && !disabled;

  // Create the map once (only while the host still has to answer).
  useEffect(() => {
    if (!interactive) return;
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        ...DEFAULT_VIEW,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      const marker = new maplibregl.Marker({ color: "#ff385c", draggable: true });
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        setSource("map");
        setPoint({ lat, lng });
      });
      map.on("click", (e) => {
        setSource("map");
        setPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      markerRef.current = marker;
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [interactive]);

  // Keep the pin where the point is, and name the spot.
  useEffect(() => {
    if (!point) return;
    const map = mapRef.current;
    if (map && markerRef.current) markerRef.current.setLngLat([point.lng, point.lat]).addTo(map);
    let stale = false;
    const timer = setTimeout(() => {
      setNaming(true);
      geocode({ lat: String(point.lat), lng: String(point.lng) })
        .then(([p]) => !stale && setPlace(p ?? null))
        .catch(() => !stale && setPlace(null))
        .finally(() => !stale && setNaming(false));
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [point]);

  // Search as they type.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    let stale = false;
    const timer = setTimeout(() => {
      geocode({ q })
        .then((places) => !stale && setResults(places))
        .catch(() => !stale && setResults([]));
    }, 450);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  function useMyLocation() {
    if (!navigator.geolocation) return setError("This browser can't share your location. Pick it on the map.");
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        setSource("gps");
        setPoint({ lat: coords.latitude, lng: coords.longitude });
        mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 15 });
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location access was blocked. Search or tap the map instead."
            : "Couldn't get your location. Search or tap the map instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function choose(p: Place) {
    setQuery("");
    setResults([]);
    setSource("map");
    setPoint({ lat: p.lat, lng: p.lng });
    mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 15 });
  }

  if (done) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-sm font-medium text-ink">
        <PinIcon size={15} className="text-rausch" />
        {done.label}
      </div>
    );
  }

  return (
    <div className={`space-y-4 rounded-card border border-hairline bg-canvas p-4 sm:p-5 ${disabled ? "opacity-50" : ""}`}>
      <p className="text-[15px] leading-relaxed text-ink">{input.intro}</p>
      {interactive && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={locating} onClick={useMyLocation}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden="true">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
              {locating ? "Finding you…" : "Use my current location"}
            </Button>
            <span className="text-[13px] text-muted">or search / tap the map</span>
          </div>

          <div className="relative">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search an address or neighborhood"
              className="h-12 w-full rounded-lg border border-hairline bg-canvas pl-10 pr-3 text-[15px] text-ink outline-none transition-colors placeholder:text-muted focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--color-ink)]"
            />
            {query.trim().length >= 3 && results.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-card bg-canvas py-2 shadow-float">
                {results.map((r) => (
                  <li key={`${r.lat},${r.lng}`}>
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface-soft"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-strong">
                        <PinIcon size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{r.short}</span>
                        <span className="block truncate text-[13px] text-muted">{r.label}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div ref={containerRef} className="h-64 overflow-hidden rounded-xl bg-surface-strong" />

          {error && <div className="text-sm text-error">{error}</div>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              {point ? (
                <>
                  <div className="font-semibold text-ink">{naming ? "Looking up…" : (place?.short ?? "Pinned spot")}</div>
                  <div className="text-[13px] text-muted">Guests only see the area (about 1 km) until you accept them.</div>
                </>
              ) : (
                <span className="text-muted">No spot picked yet.</span>
              )}
            </div>
            <Button
              size="sm"
              disabled={!point || naming}
              onClick={() =>
                point &&
                onDone?.({
                  point,
                  label: place?.short ?? `${point.lat.toFixed(3)}, ${point.lng.toFixed(3)}`,
                  address: place?.label ?? "",
                  source,
                })
              }
            >
              That&apos;s my place
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
