export type Market = {
  id: string;
  name: string;
  bounds: { north: number; south: number; east: number; west: number };
};

export const MARKETS: Market[] = [
  {
    id: "sf-bay-area",
    name: "SF Bay Area",
    // Marin/Napa down to Santa Cruz, coast to the East Bay hills/Tri-Valley.
    bounds: { north: 38.35, south: 36.95, east: -121.55, west: -123.1 },
  },
];

export function marketFor(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return null;
  const m = MARKETS.find(
    ({ bounds: b }) => lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west,
  );
  return m?.id ?? null;
}
