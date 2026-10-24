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
  { id: "helpx", name: "HelpX", kind: "work_exchange", access: "public", baseUrl: "https://www.helpx.net" },
  { id: "nomador", name: "Nomador", kind: "house_sit", access: "public", baseUrl: "https://www.nomador.com" },
  { id: "mindmyhouse", name: "MindMyHouse", kind: "house_sit", access: "public", baseUrl: "https://www.mindmyhouse.com" },
  { id: "housecarers", name: "HouseCarers", kind: "house_sit", access: "public", baseUrl: "https://www.housecarers.com" },
  {
    id: "housesittersamerica",
    name: "House Sitters America",
    kind: "house_sit",
    access: "public",
    baseUrl: "https://www.housesittersamerica.com",
  },
  { id: "wwoof-usa", name: "WWOOF-USA", kind: "farm_stay", access: "login", baseUrl: "https://wwoofusa.org" },
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
