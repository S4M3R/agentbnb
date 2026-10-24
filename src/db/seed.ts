import { sql } from "drizzle-orm";
import { db } from "./index";
import { sources } from "./schema";

type NewSource = typeof sources.$inferInsert;

const SOURCES: NewSource[] = [
  {
    id: "internal",
    name: "AgentBnB",
    kind: "internal",
    access: "internal",
    baseUrl: "https://agentbnb.agustin.build",
  },
  // Public listings: scraped directly.
  {
    id: "trustedhousesitters",
    name: "TrustedHousesitters",
    kind: "house_sit",
    access: "public",
    baseUrl: "https://www.trustedhousesitters.com",
    tosNotes: "Listings public; applying requires paid membership.",
  },
  {
    id: "workaway",
    name: "Workaway",
    kind: "work_exchange",
    access: "public",
    baseUrl: "https://www.workaway.info",
    tosNotes: "Host listings public; contacting hosts requires membership.",
  },
  {
    id: "worldpackers",
    name: "Worldpackers",
    kind: "work_exchange",
    access: "public",
    baseUrl: "https://www.worldpackers.com",
  },
  {
    id: "workingtraveller",
    name: "Working Traveller",
    kind: "work_exchange",
    access: "public",
    baseUrl: "https://www.workingtraveller.com",
  },
  { id: "helpstay", name: "HelpStay", kind: "work_exchange", access: "public", baseUrl: "https://helpstay.com" },
  {
    id: "volunteersbase",
    name: "Volunteers Base",
    kind: "work_exchange",
    access: "public",
    baseUrl: "https://www.volunteersbase.com",
  },
  { id: "helpx", name: "HelpX", kind: "work_exchange", access: "public", baseUrl: "https://www.helpx.net" },
  { id: "nomador", name: "Nomador", kind: "house_sit", access: "public", baseUrl: "https://www.nomador.com" },
  { id: "mindmyhouse", name: "MindMyHouse", kind: "house_sit", access: "public", baseUrl: "https://www.mindmyhouse.com" },
  {
    id: "housecarers",
    name: "HouseCarers",
    kind: "house_sit",
    access: "public",
    baseUrl: "https://www.housecarers.com",
    tosNotes:
      "robots.txt blocks aggregators/scrapers by name. Scraped once for the demo; don't re-run without permission.",
  },
  {
    id: "housesittersamerica",
    name: "House Sitters America",
    kind: "house_sit",
    access: "public",
    baseUrl: "https://www.housesittersamerica.com",
  },
  { id: "wwoof-usa", name: "WWOOF-USA", kind: "farm_stay", access: "login", baseUrl: "https://wwoofusa.org" },
  // Home swap.
  {
    id: "homeexchange",
    name: "HomeExchange",
    kind: "home_swap",
    access: "public",
    baseUrl: "https://www.homeexchange.com",
  },
  { id: "kindred", name: "Kindred", kind: "home_swap", access: "public", baseUrl: "https://livekindred.com" },
  { id: "homelink", name: "HomeLink", kind: "home_swap", access: "public", baseUrl: "https://homelink.org" },
  {
    id: "intervac",
    name: "Intervac",
    kind: "home_swap",
    access: "public",
    baseUrl: "https://us.intervac-homeexchange.com",
  },
  // Paid rooms, sublets, coliving, furnished rentals.
  {
    id: "airbnb",
    name: "Airbnb",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.airbnb.com",
    tosNotes: "ToS prohibits scraping; scraped small-volume for the demo only.",
  },
  {
    id: "anyplace",
    name: "Anyplace",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.anyplace.com",
  },
  {
    id: "apartmentlist",
    name: "Apartment List",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.apartmentlist.com",
    tosNotes: "ToS prohibits scraping; scraped small-volume for the demo only.",
  },
  {
    id: "blueground",
    name: "Blueground",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.theblueground.com",
  },
  {
    id: "bungalow",
    name: "Bungalow",
    kind: "rental",
    access: "public",
    baseUrl: "https://bungalow.com",
  },
  {
    id: "craigslist",
    name: "Craigslist",
    kind: "rental",
    access: "public",
    baseUrl: "https://sfbay.craigslist.org",
    tosNotes: "ToS prohibits scraping; scraped small-volume for the demo only.",
  },
  {
    id: "facebook-groups",
    name: "Facebook groups",
    kind: "rental",
    access: "login",
    baseUrl: "https://www.facebook.com/groups",
    tosNotes: "Read manually-paced from the user's own logged-in session; only offer posts, storing post URL + poster profile URL.",
  },
  {
    id: "landing",
    name: "Landing",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.hellolanding.com",
  },
  {
    id: "outsite",
    name: "Outsite",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.outsite.co",
  },
  {
    id: "padsplit",
    name: "PadSplit",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.padsplit.com",
    tosNotes: "ToS prohibits scraping; scraped small-volume for the demo only.",
  },
  {
    id: "roomi",
    name: "Roomi",
    kind: "rental",
    access: "public",
    baseUrl: "https://roomiapp.com",
    tosNotes: "robots.txt disallows /listings/; public location and room-rental pages scraped small-volume for the demo only.",
  },
  {
    id: "roomster",
    name: "Roomster",
    kind: "rental",
    access: "public",
    baseUrl: "https://roomster.com",
  },
  {
    id: "sabbaticalhomes",
    name: "SabbaticalHomes",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.sabbaticalhomes.com",
  },
  {
    id: "spareroom",
    name: "SpareRoom",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.spareroom.com",
  },
  {
    id: "tripalink",
    name: "Tripalink",
    kind: "rental",
    access: "public",
    baseUrl: "https://tripalink.com",
  },
  {
    id: "zumper",
    name: "Zumper",
    kind: "rental",
    access: "public",
    baseUrl: "https://www.zumper.com",
    tosNotes: "ToS prohibits scraping; scraped small-volume for the demo only.",
  },
  // Hostels (per-night beds).
  {
    id: "hiusa",
    name: "HI USA",
    kind: "hostel",
    access: "public",
    baseUrl: "https://www.hiusa.org",
  },
  {
    id: "hostelworld",
    name: "Hostelworld",
    kind: "hostel",
    access: "public",
    baseUrl: "https://www.hostelworld.com",
  },
  // Login-gated couch surfing: only through a user's own session or a partnership.
  {
    id: "couchsurfing",
    name: "Couchsurfing",
    kind: "couch",
    access: "login",
    baseUrl: "https://www.couchsurfing.com",
    tosNotes: "Login + paid verification required; ToS prohibits scraping. User-session only.",
  },
  { id: "bewelcome", name: "BeWelcome", kind: "couch", access: "login", baseUrl: "https://www.bewelcome.org" },
  { id: "trustroots", name: "Trustroots", kind: "couch", access: "login", baseUrl: "https://www.trustroots.org" },
  {
    id: "pasportaservo",
    name: "Pasporta Servo",
    kind: "couch",
    access: "public",
    baseUrl: "https://www.pasportaservo.org",
    tosNotes: "Esperanto speakers only; personal, non-commercial use. Public map layer only (12h cache).",
  },
  { id: "couchers", name: "Couchers.org", kind: "couch", access: "login", baseUrl: "https://couchers.org" },
  { id: "warmshowers", name: "Warmshowers", kind: "couch", access: "login", baseUrl: "https://www.warmshowers.org" },
];

async function main() {
  await db
    .insert(sources)
    .values(SOURCES)
    .onConflictDoUpdate({
      target: sources.id,
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        access: sql`excluded.access`,
        baseUrl: sql`excluded.base_url`,
        tosNotes: sql`excluded.tos_notes`,
      },
    });
  console.log(`Seeded ${SOURCES.length} sources`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
