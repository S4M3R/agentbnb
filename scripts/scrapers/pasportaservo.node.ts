// Pasporta Servo publishes a public GeoJSON layer of hosts who opted into
// public listing (cached 12h server-side, so don't fetch more often). One
// request; keeps the places inside the market bounds.
//
//   npx tsx scripts/scrapers/pasportaservo.node.ts
//   pnpm ingest data/scrapes/pasportaservo-sf-bay-area-<timestamp>.json

import { mkdir, writeFile } from "node:fs/promises";
import { MARKETS } from "../../src/lib/markets";

const MARKET = "sf-bay-area";
const UA = "AgentBnB-scraper/0.1 (+https://agentbnb.agustin.build)";

type Feature = {
  id: number;
  properties: { url: string; owner_name?: string; owner_avatar?: string };
  geometry: { coordinates: [number, number] };
};

async function main() {
  const market = MARKETS.find((m) => m.id === MARKET)!;
  const startedAt = new Date().toISOString();
  const res = await fetch("https://www.pasportaservo.org/mapo/lokoj.geojson", { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`lokoj.geojson: ${res.status}`);
  const { features } = (await res.json()) as { features: Feature[] };

  const b = market.bounds;
  const items = features
    .filter(({ geometry: { coordinates: [lng, lat] } }) => lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west)
    .map((f) => ({
      id: String(f.id),
      url: new URL(f.properties.url, "https://www.pasportaservo.org").href,
      ownerName: f.properties.owner_name ?? null,
      ownerAvatar: f.properties.owner_avatar ? new URL(f.properties.owner_avatar, "https://www.pasportaservo.org").href : null,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    }));

  const file = { source: "pasportaservo", market: MARKET, startedAt, finishedAt: new Date().toISOString(), complete: true, items };
  await mkdir("data/scrapes", { recursive: true });
  const path = `data/scrapes/pasportaservo-${MARKET}-${startedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  console.log(`${items.length} places → ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
