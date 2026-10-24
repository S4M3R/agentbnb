// External networks a host can publish their place to. None has a public API for creating
// listings, so the browser agent (./publish.ts) does it in a Browserbase session the host can
// watch and take over. Ids match `sources.id` (seeded in src/db/seed.ts).

/** What the host is offering. Decides which networks fit. */
export const ARRANGEMENTS = ["hosting", "house_sit", "exchange"] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

export const ARRANGEMENT_LABEL: Record<Arrangement, string> = {
  hosting: "Free stay while you're home",
  house_sit: "Your home while you're away",
  exchange: "A bed in exchange for help",
};

export type Network = {
  id: string;
  name: string;
  url: string;
  arrangements: Arrangement[];
  /** One line on why a host would want to be here. */
  pitch: string;
  cost: string;
  /** How reliably the browser agent can publish here today. Easier ones are recommended first. */
  ease: 1 | 2 | 3;
  /** ISO country codes the network serves; omitted = worldwide. */
  countries?: string[];
  /** Only for some hosts, e.g. Warmshowers is for touring cyclists. */
  niche?: string;
  /** Where the browser agent starts. */
  startUrl: string;
  /** Site-specific hints for the browser agent. */
  guide: string;
};

export const NETWORKS: Network[] = [
  {
    id: "trustroots",
    name: "Trustroots",
    url: "https://www.trustroots.org",
    arrangements: ["hosting"],
    pitch: "Free, non-profit hospitality network for travelers and hitchhikers. Simple hosting offer.",
    cost: "Free",
    ease: 1,
    startUrl: "https://www.trustroots.org/offer/host",
    guide: `The hosting offer is one page at https://www.trustroots.org/offer/host (also reachable from the profile menu under "Hosting").
- Set the hosting status to "Yes, I can host" (use "Maybe" only if the host said so).
- Put the description in the "Tell a bit about your place" text box. Plain text, keep paragraphs.
- Set the maximum number of guests.
- Place the location marker by searching for the neighborhood and city (never the street address), then confirm the marker.
- Save. The public result is the host's profile, https://www.trustroots.org/profile/<username>; read the username from the profile menu.`,
  },
  {
    id: "bewelcome",
    name: "BeWelcome",
    url: "https://www.bewelcome.org",
    arrangements: ["hosting"],
    pitch: "Volunteer-run, open-source couch network with an active community in Europe and beyond.",
    cost: "Free",
    ease: 2,
    startUrl: "https://www.bewelcome.org/editmyprofile",
    guide: `Hosting details live on the profile editor (https://www.bewelcome.org/editmyprofile), in the "Accommodation" section.
- Set accommodation to "Yes" (or "Maybe" if the host said so) and the maximum number of guests.
- Fill the accommodation description, what you offer, and restrictions / house rules from the listing.
- Save at the bottom of the page. The public result is https://www.bewelcome.org/members/<username>.`,
  },
  {
    id: "couchsurfing",
    name: "Couchsurfing",
    url: "https://www.couchsurfing.com",
    arrangements: ["hosting"],
    pitch: "The biggest couch network, the most guests, but members pay for verification.",
    cost: "Paid verification",
    ease: 3,
    startUrl: "https://www.couchsurfing.com/home",
    guide: `Hosting details are on the profile's "My Home" tab; the hosting status is the "Accepting guests" selector.
- Set status to "Accepting Guests", the max number of guests, and the sleeping arrangement.
- Fill the home description and house rules from the listing. Save.
- If a verification or payment wall appears, stop and ask the host; never enter payment details.`,
  },
  {
    id: "couchers",
    name: "Couchers.org",
    url: "https://couchers.org",
    arrangements: ["hosting"],
    pitch: "Free, community-built Couchsurfing alternative that's growing fast.",
    cost: "Free",
    ease: 2,
    startUrl: "https://app.couchers.org/profile/edit",
    guide: `Hosting status and the "My home" details are in the profile editor.
- Set hosting status to "Can host", fill the home description, max guests and house rules. Save.`,
  },
  {
    id: "warmshowers",
    name: "Warmshowers",
    url: "https://www.warmshowers.org",
    arrangements: ["hosting"],
    pitch: "Hospitality for touring cyclists.",
    cost: "One-time fee",
    ease: 2,
    niche: "touring cyclists",
    startUrl: "https://www.warmshowers.org/",
    guide: `Hosting availability is in the profile's hosting settings. Mark the host as available, fill what you offer and the max guests. Save.`,
  },
  {
    id: "trustedhousesitters",
    name: "TrustedHousesitters",
    url: "https://www.trustedhousesitters.com",
    arrangements: ["house_sit"],
    pitch: "The largest house-sitting marketplace; sitters care for your home and pets while you're away.",
    cost: "Paid membership",
    ease: 3,
    startUrl: "https://www.trustedhousesitters.com/house-and-pet-sitting-assignments/",
    guide: `Owners create a listing (home, pets, responsibilities) and then add sit dates.
- Fill the home description, pets, responsibilities and dates from the listing.
- If a membership or payment wall appears, stop and ask the host; never enter payment details.`,
  },
  {
    id: "nomador",
    name: "Nomador",
    url: "https://www.nomador.com",
    arrangements: ["house_sit"],
    pitch: "House sitting with a free tier for home owners, strong in Europe and Australia.",
    cost: "Free for owners",
    ease: 2,
    startUrl: "https://www.nomador.com/",
    guide: `Owners post a "house sit" with home details, pets and dates. Fill them from the listing and publish.`,
  },
  {
    id: "housecarers",
    name: "HouseCarers",
    url: "https://www.housecarers.com",
    arrangements: ["house_sit"],
    pitch: "Long-running house-sitting site, free for home owners.",
    cost: "Free for owners",
    ease: 2,
    startUrl: "https://www.housecarers.com/",
    guide: `Home owners add a house sit with location, dates, pets and duties. Fill it from the listing and publish.`,
  },
  {
    id: "housesittersamerica",
    name: "House Sitters America",
    url: "https://www.housesittersamerica.com",
    arrangements: ["house_sit"],
    pitch: "US-only house sitting, free for home owners.",
    cost: "Free for owners",
    ease: 2,
    countries: ["US"],
    startUrl: "https://www.housesittersamerica.com/",
    guide: `Home owners post a house sit with dates, pets and duties. Fill it from the listing and publish.`,
  },
  {
    id: "workaway",
    name: "Workaway",
    url: "https://www.workaway.info",
    arrangements: ["exchange"],
    pitch: "The biggest work-exchange network: a few hours of help a day for a bed and meals.",
    cost: "Host membership",
    ease: 3,
    startUrl: "https://www.workaway.info/",
    guide: `Hosts create a host profile describing the help needed, accommodation and hours. Hosts are reviewed by Workaway before going live; report that as success once submitted.`,
  },
  {
    id: "worldpackers",
    name: "Worldpackers",
    url: "https://www.worldpackers.com",
    arrangements: ["exchange"],
    pitch: "Work exchange popular with younger travelers and hostels.",
    cost: "Free for hosts",
    ease: 3,
    startUrl: "https://www.worldpackers.com/",
    guide: `Hosts apply with a host profile and positions (tasks, hours, benefits). Fill it from the listing and submit for review.`,
  },
  {
    id: "helpx",
    name: "HelpX",
    url: "https://www.helpx.net",
    arrangements: ["exchange"],
    pitch: "Simple, old-school work-exchange listings, free to list.",
    cost: "Free for hosts",
    ease: 2,
    startUrl: "https://www.helpx.net/",
    guide: `Hosts register and fill one host listing (description, help wanted, accommodation). Fill it from the listing and submit.`,
  },
];

export function getNetwork(id: string) {
  return NETWORKS.find((n) => n.id === id);
}

export type NetworkFit = {
  id: string;
  name: string;
  url: string;
  pitch: string;
  cost: string;
  recommended: boolean;
  reason: string;
};

/**
 * Networks that fit what the host offers, best first. The top few (free, easy to automate, no
 * niche) are marked recommended so "OK" means something concrete.
 */
export function recommendNetworks(listing: {
  arrangement: Arrangement;
  countryCode: string | null;
  forCyclists?: boolean;
}): NetworkFit[] {
  const fits = NETWORKS.filter(
    (n) =>
      n.arrangements.includes(listing.arrangement) &&
      (!n.countries || !listing.countryCode || n.countries.includes(listing.countryCode)) &&
      (!n.niche || (n.id === "warmshowers" && listing.forCyclists)),
  ).sort((a, b) => a.ease - b.ease);

  let picks = 0;
  return fits.map((n) => {
    const recommended = picks < 3 && n.ease < 3;
    if (recommended) picks++;
    return {
      id: n.id,
      name: n.name,
      url: n.url,
      pitch: n.pitch,
      cost: n.cost,
      recommended,
      reason: recommended
        ? `${n.cost}. I fill everything in; you just log in when asked.`
        : n.ease === 3
          ? `${n.cost}; I'll likely need you to step in for sign-up or payment.`
          : `${n.cost}.`,
    };
  });
}
