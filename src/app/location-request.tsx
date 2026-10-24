"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

// The askForLocation tool in the chat: share your current location or drop a pin on the map
// (with place search). Returns the point and a short place name to the agent.

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const DEFAULT_VIEW = { center: [-122.42, 37.77] as [number, number], zoom: 10 }; // SF Bay Area

type Point = { lat: number; lng: number };
type Place = Point & { label: string; short: string };
export type LocationRequestInput = { intro: string };
export type LocationRequestOutput = { point: Point; label: string; address: string; source: "gps" | "map" };

const primary =
  "rounded-lg bg-[#ff385c] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e00b41] disabled:bg-[#ffd1da]";
const secondary =
  "inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium transition-colors hover:border-zinc-500 disabled:opacity-50 dark:border-zinc-700";

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
    return <div className="text-sm text-zinc-600 dark:text-zinc-400">📍 {done.label}</div>;
  }

  return (
    <div className={`space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 ${disabled ? "opacity-50" : ""}`}>
      <p className="text-sm">{input.intro}</p>
      {interactive && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={secondary} disabled={locating} onClick={useMyLocation}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </svg>
              {locating ? "Finding you…" : "Use my current location"}
            </button>
            <span className="text-xs text-zinc-500">or search / tap the map</span>
          </div>

          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search an address or neighborhood"
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
            {query.trim().length >= 3 && results.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-zinc-200 bg-background shadow-lg dark:border-zinc-800">
                {results.map((r) => (
                  <li key={`${r.lat},${r.lng}`}>
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <span className="font-medium">{r.short}</span>
                      <span className="block truncate text-xs text-zinc-500">{r.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div ref={containerRef} className="h-64 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900" />

          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              {point ? (
                <>
                  <div className="font-medium">{naming ? "Looking up…" : (place?.short ?? "Pinned spot")}</div>
                  <div className="text-xs text-zinc-500">Guests only see the area (about 1 km) until you accept them.</div>
                </>
              ) : (
                <span className="text-zinc-500">No spot picked yet.</span>
              )}
            </div>
            <button
              type="button"
              className={primary}
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
            </button>
          </div>
        </>
      )}
    </div>
  );
}
