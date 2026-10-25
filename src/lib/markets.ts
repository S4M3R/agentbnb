type Box = { north: number; south: number; east: number; west: number };

export type Market = {
  id: string;
  name: string;
  /** The main area; the map opens framed on it. */
  bounds: Box;
  /** More of the same market that the main box would overshoot if stretched to cover it. */
  extra?: Box[];
};

export const MARKETS: Market[] = [
  {
    id: "sf-bay-area",
    name: "SF Bay Area",
    // Marin/Napa down to Santa Cruz, coast to the East Bay hills/Tri-Valley.
    bounds: { north: 38.35, south: 36.95, east: -121.55, west: -123.1 },
    // Northern Sonoma and Napa (Santa Rosa, Healdsburg, Calistoga, Cazadero, the Sonoma coast), part of the
    // nine-county Bay Area. Kept west of -122.05 so Davis and the Sacramento Valley stay out.
    extra: [{ north: 38.86, south: 38.35, east: -122.05, west: -123.55 }],
  },
];

const inside = (lat: number, lng: number, b: Box) => lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;

export function marketFor(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return null;
  const m = MARKETS.find((m) => inside(lat, lng, m.bounds) || m.extra?.some((b) => inside(lat, lng, b)));
  return m?.id ?? null;
}
