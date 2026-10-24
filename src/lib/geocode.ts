// Address → coordinates via OpenStreetMap Nominatim. Fine for a demo's volume (their policy:
// ≤1 request/second and an identifying User-Agent); swap for a paid geocoder before launch.

export type Place = {
  lat: number;
  lng: number;
  neighborhood: string | null;
  city: string | null;
  subregion: string | null;
  region: string | null;
  countryCode: string | null;
  label: string;
};

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  address: Record<string, string | undefined>;
};

/**
 * Geocode what a person typed, which is often looser than an address ("Mission, near 24th &
 * Valencia, SF"). Tries it as written, then without "near …" phrases, then dropping leading
 * comma-separated parts until something matches. `exact` is false when we fell back.
 */
export async function geocodeLoose(query: string): Promise<(Place & { exact: boolean }) | null> {
  const cleaned = query
    .replace(/\b(near|by|close to|around|next to)\b[^,]*/gi, "")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  const candidates = [...new Set([query, cleaned, ...parts.map((_, i) => parts.slice(i).join(", "))])].filter(
    (c) => c.length >= 3,
  );
  for (const [i, candidate] of candidates.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000)); // Nominatim allows 1 request/second
    const place = await geocode(candidate);
    if (place) return { ...place, exact: i === 0 };
  }
  return null;
}

export async function geocode(query: string): Promise<Place | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q: query, format: "jsonv2", addressdetails: "1", limit: "1" }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": "AgentBnB/0.1 (https://agentbnb.agustin.build)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const [hit] = (await res.json()) as NominatimResult[];
  if (!hit) return null;

  const a = hit.address;
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    neighborhood: a.neighbourhood ?? a.suburb ?? a.quarter ?? null,
    city: a.city ?? a.town ?? a.village ?? a.hamlet ?? null,
    subregion: a.county ?? null,
    region: a.state ?? null,
    countryCode: a.country_code?.toUpperCase() ?? null,
    label: hit.display_name,
  };
}

/**
 * Coordinates we can show publicly for a host's place: rounded to ~1 km so the pin never points
 * at their door. The exact address stays in listings.address for confirmed guests only.
 */
export function publicCoordinates(place: { lat: number; lng: number }) {
  return { lat: Math.round(place.lat * 100) / 100, lng: Math.round(place.lng * 100) / 100 };
}
