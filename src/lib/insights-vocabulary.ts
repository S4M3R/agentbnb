// The fixed tag vocabulary for listing_insights.tags. The analysis model may only pick from these,
// so search can filter on them (`tags @> '{pets:cat}'`) without synonyms. Keep it small: add a tag
// only when a guest would plausibly search for it, and describe it so the model applies it the
// same way every time. Changing a description or adding a tag changes the prompt, which changes
// every content_hash, so the next `pnpm analyze` reruns everything.

export const TAGS = {
  // What the guest does in exchange (work exchange, farm stays, house sits)
  "help:pet_care": "Guest looks after the host's pets (house sits, pet sits).",
  "help:house_care": "Guest minds the home: plants, mail, security, light upkeep.",
  "help:gardening": "Gardening, landscaping, orchard or yard work.",
  "help:farm": "Farm work: crops, harvest, permaculture, WWOOF-style tasks.",
  "help:animal_care": "Caring for livestock or many animals (horses, goats, chickens, sanctuary).",
  "help:hostel": "Hostel or guesthouse work: reception, front desk, housekeeping, bar.",
  "help:cleaning": "Cleaning or housekeeping is a main task.",
  "help:cooking": "Cooking or kitchen work.",
  "help:childcare": "Looking after children, au pair, family help.",
  "help:building": "Construction, carpentry, renovation, maintenance, DIY.",
  "help:teaching": "Teaching or tutoring (languages, kids, classes).",
  "help:creative": "Creative or digital work: photo, video, design, social media, marketing, web.",
  "help:eldercare": "Companionship or help for an older or disabled person.",

  // Animals living there (for house sits, farms and homes)
  "pets:dog": "One or more dogs live there.",
  "pets:cat": "One or more cats live there.",
  "pets:horse": "Horses or donkeys.",
  "pets:farm_animals": "Chickens, goats, sheep, pigs, cows or other livestock.",
  "pets:small_animals": "Rabbits, guinea pigs, birds, fish, reptiles or similar.",
  "pets:guest_pets_ok": "The guest may bring their own pet.",

  // Sleeping arrangement
  "room:entire_place": "The guest has the whole home (house sits, home swaps, apartments).",
  "room:private": "A private bedroom in a shared home.",
  "room:shared": "Shares a room with others (dorm, shared room).",
  "bath:private": "Private or ensuite bathroom.",
  "bed:couch": "Sleeps on a couch, sofa bed, air mattress or floor.",
  "bed:dorm": "A bed in a hostel dorm or bunk room.",
  "bed:camping": "Tent, camper, RV, yurt, cabin-on-land or other outdoor/rustic sleeping.",

  // The place
  "workspace:desk": "A desk or dedicated workspace is mentioned or visible.",
  wifi: "Wi-Fi or internet is available.",
  "wifi:fast": "Fast or high-speed internet is explicitly mentioned.",
  kitchen: "Guest can use a kitchen.",
  laundry: "Washer/dryer or laundry on site.",
  parking: "Parking available.",
  "outdoor:garden": "A garden or large green yard.",
  "outdoor:patio": "Balcony, deck, patio, terrace or rooftop.",
  pool: "Swimming pool.",
  hot_tub: "Hot tub, jacuzzi or sauna.",
  fireplace: "Fireplace or wood stove.",
  ac: "Air conditioning.",
  furnished: "Furnished (for rentals and rooms).",
  accessible: "Step-free or wheelchair accessible.",
  "view:water": "Ocean, bay, lake or river view.",
  "view:city": "City or skyline view.",
  "view:mountain": "Mountain or hills view.",

  // Setting
  "setting:urban": "In a city, dense neighborhood.",
  "setting:suburban": "Suburb or residential area.",
  "setting:small_town": "A small town or village.",
  "setting:rural": "Countryside or farmland, outside towns.",
  "setting:remote": "Remote, off-grid or far from towns.",
  nature: "Surrounded by nature: forest, fields, wilderness, big land.",
  "near:beach": "Walking distance or a short drive to a beach.",
  "near:transit": "Close to public transit (BART, metro, bus, train).",
  "near:downtown": "Central, walkable to shops, restaurants, downtown.",
  "near:hiking": "Trails, parks or hiking nearby.",
  "near:university": "Close to a university or campus.",

  // Vibe and who it suits
  "vibe:quiet": "Calm, peaceful, quiet.",
  "vibe:social": "Social: shared house, community, hostel, events, other volunteers.",
  "vibe:cozy": "Cozy, homey, warm.",
  "vibe:luxury": "High-end, designer, spacious or upscale.",
  "vibe:rustic": "Rustic, simple, basic, off-grid living.",
  "vibe:eco": "Sustainable, permaculture, eco or off-grid values.",
  "vibe:wellness": "Yoga, meditation, retreat, spiritual or wellness.",
  "vibe:creative": "Artist, music or maker community.",
  kids: "Good for families with kids (kid gear, kids welcome, family home).",
  "good_for:remote_work": "Works well for working remotely (desk, good Wi-Fi, quiet).",
  "good_for:long_stay": "Suited to stays of a month or more.",
  "good_for:short_stay": "Fine for a few nights or a weekend.",
  "good_for:couples": "Couples welcome.",
  "good_for:solo": "Best for one person.",
  "good_for:groups": "Fits a group or several guests.",
  "good_for:students": "Aimed at students or academics.",
  women_only: "Only women (or only female guests) accepted.",
  lgbtq_friendly: "Explicitly LGBTQ+ friendly.",

  // Cost and food
  "price:free": "No money changes hands (house sit, exchange, hosting).",
  "price:budget": "Cheap for the area.",
  "meals:included": "Some or all meals are provided.",
} as const;

export type Tag = keyof typeof TAGS;
export const TAG_LIST = Object.keys(TAGS) as [Tag, ...Tag[]];

/** The vocabulary as prompt text, one tag per line. */
export function tagGuide() {
  return TAG_LIST.map((t) => `- ${t}: ${TAGS[t]}`).join("\n");
}

/** The kind of stay, one value per listing (features.kind). Finer than listings.type. */
export const STAY_KINDS = [
  "couch",
  "private_room",
  "shared_room",
  "dorm_bed",
  "entire_place",
  "house_sit",
  "work_exchange",
  "farm_stay",
  "home_swap",
  "camping",
] as const;

/** Why a listing scored low. */
export const QUALITY_FLAGS = [
  "empty_description", // little or no text
  "no_photos",
  "placeholder_photos", // stock, logo, map or "no image" pictures
  "few_details", // missing dates, price, rooms, or what's expected
  "duplicate_text", // same text as other listings
  "spam_or_scam", // asks for money off-platform, too good to be true, contact-me-elsewhere
  "not_a_stay", // an ad for something else (job, sale, service)
  "outdated", // the text refers to dates long past
  "machine_translated", // garbled or auto-translated text
] as const;
