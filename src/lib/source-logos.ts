// Marketplace logos in /public/logos, by source id.
const LOGOS: Record<string, string> = {
  bewelcome: "/logos/bewelcome.svg",
  couchers: "/logos/couchers.png",
  couchsurfing: "/logos/couchsurfing.png",
  helpx: "/logos/helpx.png",
  housecarers: "/logos/housecarers.png",
  housesittersamerica: "/logos/housesittersamerica.png",
  mindmyhouse: "/logos/mindmyhouse.png",
  nomador: "/logos/nomador.svg",
  trustedhousesitters: "/logos/trustedhousesitters.png",
  trustroots: "/logos/trustroots.png",
  warmshowers: "/logos/warmshowers.svg",
  workaway: "/logos/workaway.svg",
  worldpackers: "/logos/worldpackers.png",
  "wwoof-usa": "/logos/wwoof-usa.png",
};

export function logoFor(sourceId: string) {
  return LOGOS[sourceId] ?? null;
}
