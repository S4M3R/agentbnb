import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiError } from "@/lib/api-auth";
import { importRequest } from "@/lib/requests";
import { webSession } from "@/lib/session";

// Development only: give this browser's person a paused demo listing and a few made-up requests
// (two external, one from an AgentBnB member) so the Requests tab and background checks can be tried.

const { listings, users, applications } = schema;

function inDays(n: number) {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

export async function POST() {
  if (process.env.NODE_ENV === "production") return apiError(404, "NOT_FOUND", "Not found.");

  const host = await (await webSession()).ensureUser("Demo host");

  let [listing] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.hostUserId, host.id), sql`${listings.attributes}->>'demo' = 'true'`));
  if (!listing) {
    [listing] = await db
      .insert(listings)
      .values({
        sourceId: "internal",
        hostUserId: host.id,
        type: "private_room",
        title: "Sunny spare room near Lake Merritt",
        city: "Oakland",
        region: "CA",
        countryCode: "US",
        market: "sf-bay-area",
        locationPrecision: "city",
        status: "paused", // never shows up in search or on the map
        attributes: { demo: true },
      })
      .returning({ id: listings.id });
  }

  await importRequest(host.id, {
    source: "couchsurfing",
    externalRef: `demo-${host.id}-cs`,
    externalUrl: "https://www.couchsurfing.com/messages",
    listingId: listing.id,
    guest: {
      name: "Lena Hoffmann",
      username: "lena.hoff.travels",
      profileUrl: "https://www.couchsurfing.com/people/lena.hoff.travels",
      location: "Hamburg, Germany",
      age: 29,
      memberSince: "2017",
      references: 23,
      verified: true,
      languages: ["German", "English", "Spanish"],
      about: "UX researcher. Cycling the Pacific Coast from Seattle to San Diego this autumn.",
    },
    message:
      "Hi! I'm cycling down the coast and will reach Oakland on Friday. Could I stay two nights? I'm tidy, I cook, and I'd love to hear your favourite spots around the lake.",
    startDate: inDays(6),
    endDate: inDays(8),
    guestCount: 1,
  });

  await importRequest(host.id, {
    source: "trustroots",
    externalRef: `demo-${host.id}-tr`,
    externalUrl: "https://www.trustroots.org/messages",
    listingId: listing.id,
    guest: {
      name: "Tomás Rivera",
      username: "tomasrv",
      profileUrl: "https://www.trustroots.org/profile/tomasrv",
      location: "Valencia, Spain",
      memberSince: "2025",
      references: 0,
      languages: ["Spanish", "English"],
    },
    message: "hey can i crash tonight? arriving late. can send you money on paypal if easier",
    startDate: inDays(0),
    endDate: inDays(1),
    guestCount: 2,
  });

  // An AgentBnB member applying through the internal network.
  const guestEmail = `demo-guest+${host.id}@agentbnb.invalid`;
  let [guest] = await db.select({ id: users.id }).from(users).where(eq(users.email, guestEmail));
  if (!guest) {
    [guest] = await db
      .insert(users)
      .values({
        name: "Priya Natarajan",
        email: guestEmail,
        homeCity: "Toronto",
        bio: "Grad student in urban planning, in the Bay Area for a transit conference.",
        languages: ["English", "Tamil"],
      })
      .returning({ id: users.id });
    await db.insert(applications).values({
      userId: guest.id,
      listingId: listing.id,
      startDate: inDays(12),
      endDate: inDays(15),
      channel: "internal",
      status: "sent",
      intro:
        "Priya is a grad student from Toronto coming for a transit conference downtown. She's looking for a quiet room for three nights and is happy to keep to herself or join for dinner.",
    });
  }

  return Response.json({ ok: true });
}
