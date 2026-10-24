// Favicons for the websites AgentBnB talks about, self-hosted in /public/favicons (fetched once from each
// site; BeWelcome, Warmshowers and WWOOF-USA come from their logos because their favicons are blank).
// Look one up by source id ("workaway") or by any URL or domain on that site. A few common non-marketplace
// sites (LinkedIn, Instagram, ...) are here too, for background-check findings and links in the chat.

// `names` are how the site is written in prose, for spotting mentions in chat replies. Sites whose names are
// everyday words (Landing, Kindred, Bungalow, X, Google) have none, so "landing" in a sentence stays plain.
const ICONS: Record<string, { icon: string; domains: string[]; names?: string[] }> = {
  internal: { icon: "/icon.svg", domains: ["agentbnb.agustin.build"] },
  airbnb: { icon: "/favicons/airbnb.png", domains: ["airbnb.com"], names: ["Airbnb"] },
  anyplace: { icon: "/favicons/anyplace.png", domains: ["anyplace.com"], names: ["Anyplace"] },
  apartmentlist: { icon: "/favicons/apartmentlist.png", domains: ["apartmentlist.com"], names: ["Apartment List"] },
  bewelcome: { icon: "/favicons/bewelcome.svg", domains: ["bewelcome.org"], names: ["BeWelcome"] },
  blueground: { icon: "/favicons/blueground.png", domains: ["theblueground.com"], names: ["Blueground"] },
  bungalow: { icon: "/favicons/bungalow.png", domains: ["bungalow.com"] },
  couchers: { icon: "/favicons/couchers.png", domains: ["couchers.org"], names: ["Couchers.org", "Couchers"] },
  couchsurfing: { icon: "/favicons/couchsurfing.png", domains: ["couchsurfing.com"], names: ["Couchsurfing"] },
  craigslist: { icon: "/favicons/craigslist.png", domains: ["craigslist.org"], names: ["Craigslist"] },
  "facebook-groups": { icon: "/favicons/facebook-groups.png", domains: ["facebook.com"], names: ["Facebook"] },
  helpstay: { icon: "/favicons/helpstay.png", domains: ["helpstay.com"], names: ["HelpStay"] },
  helpx: { icon: "/favicons/helpx.png", domains: ["helpx.net"], names: ["HelpX"] },
  hiusa: { icon: "/favicons/hiusa.png", domains: ["hiusa.org"], names: ["HI USA", "Hostelling International"] },
  homeexchange: { icon: "/favicons/homeexchange.png", domains: ["homeexchange.com"], names: ["HomeExchange"] },
  homelink: { icon: "/favicons/homelink.png", domains: ["homelink.org"], names: ["HomeLink"] },
  hostelworld: { icon: "/favicons/hostelworld.png", domains: ["hostelworld.com"], names: ["Hostelworld"] },
  housecarers: { icon: "/favicons/housecarers.png", domains: ["housecarers.com"], names: ["HouseCarers"] },
  housesittersamerica: { icon: "/favicons/housesittersamerica.png", domains: ["housesittersamerica.com"], names: ["House Sitters America"] },
  intervac: { icon: "/favicons/intervac.png", domains: ["intervac-homeexchange.com"], names: ["Intervac"] },
  kindred: { icon: "/favicons/kindred.png", domains: ["livekindred.com"] },
  landing: { icon: "/favicons/landing.png", domains: ["hellolanding.com"] },
  mindmyhouse: { icon: "/favicons/mindmyhouse.png", domains: ["mindmyhouse.com"], names: ["MindMyHouse"] },
  nomador: { icon: "/favicons/nomador.png", domains: ["nomador.com"], names: ["Nomador"] },
  outsite: { icon: "/favicons/outsite.png", domains: ["outsite.co"], names: ["Outsite"] },
  padsplit: { icon: "/favicons/padsplit.png", domains: ["padsplit.com"], names: ["PadSplit"] },
  pasportaservo: { icon: "/favicons/pasportaservo.png", domains: ["pasportaservo.org"], names: ["Pasporta Servo"] },
  roomi: { icon: "/favicons/roomi.png", domains: ["roomiapp.com"], names: ["Roomi"] },
  roomster: { icon: "/favicons/roomster.png", domains: ["roomster.com"], names: ["Roomster"] },
  sabbaticalhomes: { icon: "/favicons/sabbaticalhomes.png", domains: ["sabbaticalhomes.com"], names: ["SabbaticalHomes"] },
  spareroom: { icon: "/favicons/spareroom.png", domains: ["spareroom.com"], names: ["SpareRoom"] },
  tripalink: { icon: "/favicons/tripalink.png", domains: ["tripalink.com"], names: ["Tripalink"] },
  trustedhousesitters: { icon: "/favicons/trustedhousesitters.png", domains: ["trustedhousesitters.com"], names: ["TrustedHousesitters", "Trusted Housesitters"] },
  trustroots: { icon: "/favicons/trustroots.png", domains: ["trustroots.org"], names: ["Trustroots"] },
  volunteersbase: { icon: "/favicons/volunteersbase.png", domains: ["volunteersbase.com"], names: ["Volunteers Base"] },
  warmshowers: { icon: "/favicons/warmshowers.svg", domains: ["warmshowers.org"], names: ["Warmshowers"] },
  workaway: { icon: "/favicons/workaway.png", domains: ["workaway.info"], names: ["Workaway"] },
  workingtraveller: { icon: "/favicons/workingtraveller.png", domains: ["workingtraveller.com"], names: ["Working Traveller"] },
  worldpackers: { icon: "/favicons/worldpackers.png", domains: ["worldpackers.com"], names: ["Worldpackers"] },
  "wwoof-usa": { icon: "/favicons/wwoof-usa.png", domains: ["wwoofusa.org"], names: ["WWOOF-USA", "WWOOF"] },
  zumper: { icon: "/favicons/zumper.png", domains: ["zumper.com"], names: ["Zumper"] },
  // Not marketplaces: sites background checks and the agent link to.
  github: { icon: "/favicons/github.svg", domains: ["github.com"], names: ["GitHub"] },
  google: { icon: "/favicons/google.png", domains: ["google.com"] },
  instagram: { icon: "/favicons/instagram.png", domains: ["instagram.com"], names: ["Instagram"] },
  linkedin: { icon: "/favicons/linkedin.svg", domains: ["linkedin.com"], names: ["LinkedIn"] },
  reddit: { icon: "/favicons/reddit.png", domains: ["reddit.com"], names: ["Reddit"] },
  substack: { icon: "/favicons/substack.png", domains: ["substack.com"], names: ["Substack"] },
  tiktok: { icon: "/favicons/tiktok.png", domains: ["tiktok.com"], names: ["TikTok"] },
  x: { icon: "/favicons/x.png", domains: ["x.com", "twitter.com"] },
  youtube: { icon: "/favicons/youtube.png", domains: ["youtube.com", "youtu.be"], names: ["YouTube"] },
};

const BY_DOMAIN = new Map(Object.entries(ICONS).flatMap(([id, s]) => s.domains.map((d) => [d, id] as const)));

/** The source id for a URL or bare domain, matching subdomains too ("sfbay.craigslist.org"). */
export function sourceForUrl(urlOrDomain: string) {
  let host: string;
  try {
    host = new URL(urlOrDomain.includes("://") ? urlOrDomain : `https://${urlOrDomain}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (let h = host; h.includes("."); h = h.slice(h.indexOf(".") + 1)) {
    const id = BY_DOMAIN.get(h);
    if (id) return id;
  }
  return null;
}

/** The favicon for a source id, or for a URL or domain on a site we know. Null when we don't have one. */
export function faviconFor(sourceIdOrUrl: string | null | undefined) {
  if (!sourceIdOrUrl) return null;
  const id = ICONS[sourceIdOrUrl] ? sourceIdOrUrl : sourceForUrl(sourceIdOrUrl);
  return id ? ICONS[id].icon : null;
}

/** Kept for existing callers: the favicon for a source id. */
export function logoFor(sourceId: string) {
  return faviconFor(sourceId);
}

/** Every site name we can spot in prose, longest first, with its source id. */
export const SITE_MENTIONS: { name: string; id: string }[] = Object.entries(ICONS)
  .flatMap(([id, s]) => (s.names ?? []).map((name) => ({ name, id })))
  .sort((a, b) => b.name.length - a.name.length);
