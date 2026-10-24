import type { NormalizedListing, SourceAdapter } from "./types";

/** One item per hostel per room type, as written by scripts/scrapers/hiusa.node.ts. */
type HiusaRaw = {
  hostel: {
    wpId: number;
    slug: string;
    url: string;
    name: string;
    description: string | null;
    address: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string } | null;
    telephone: string | null;
    lat: number | null;
    lng: number | null;
    hostelCode: string | null;
    basics: string[];
    amenities: string[];
    photos: string[];
    rooms: unknown[];
    faqUrl: string | null;
    faq: { q: string; a: string }[];
  };
  room: {
    name: string;
    beds: number | null;
    guests: number | null;
    ensuite: boolean;
    photos: { url: string; caption: string | null }[];
  };
};

const COUNTY: Record<string, string> = {
  "San Francisco": "San Francisco County",
  Montara: "San Mateo County",
  Pescadero: "San Mateo County",
  "Half Moon Bay": "San Mateo County",
  Sausalito: "Marin County",
  "Santa Cruz": "Santa Cruz County",
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function roomType(name: string): NormalizedListing["type"] {
  if (/dorm/i.test(name)) return "shared_room";
  if (/^entire\b/i.test(name)) return "entire_place";
  return "private_room";
}

const faqAnswer = (faq: HiusaRaw["hostel"]["faq"], q: RegExp) => faq.find((f) => q.test(f.q))?.a ?? null;
const anyAnswer = (faq: HiusaRaw["hostel"]["faq"], a: RegExp) => faq.some((f) => a.test(f.a));

export const hiusa: SourceAdapter = {
  sourceId: "hiusa",

  normalize(input) {
    const r = input as HiusaRaw;
    const h = r?.hostel;
    const room = r?.room;
    if (!h?.name || !room?.name || !h.hostelCode) return null;

    const faq = h.faq ?? [];
    const basic = (re: RegExp) => h.basics.find((b) => re.test(b))?.replace(re, "").trim() || null;
    const checkIn = basic(/^check-in:\s*/i);
    const checkOut = basic(/^check-out:\s*/i);
    const maxStayText = faqAnswer(faq, /maximum length of stay/i);
    const maxStay = maxStayText?.match(/(\d{1,3})\s*(night|day)s?/i);
    const curfew = faqAnswer(faq, /curfew/i);
    const quietHours = faqAnswer(faq, /quiet hours/i);
    const minors = faqAnswer(faq, /minors/i);
    const residents = faqAnswer(faq, /residents/i);
    const linens = faqAnswer(faq, /linens|towels/i);
    const type = roomType(room.name);

    const a = h.address ?? {};
    const address =
      [a.streetAddress, a.addressLocality, [a.addressRegion, a.postalCode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ") || null;

    const amenities = [
      ...h.amenities,
      room.ensuite ? "Ensuite bathroom" : null,
      linens && /included/i.test(linens) ? "Linens included" : null,
      anyAnswer(faq, /\bkitchen\b/i) ? "Kitchen" : null,
      anyAnswer(faq, /\blockers?\b/i) ? "Lockers" : null,
      anyAnswer(faq, /free (wi-?fi|wifi)/i) ? "Free Wi-Fi" : null,
      anyAnswer(faq, /free breakfast|breakfast is (included|free)/i) ? "Free breakfast" : null,
    ].filter((x): x is string => !!x);

    const photos = [...room.photos.map((p) => ({ sourceUrl: p.url, caption: p.caption })), ...h.photos.map((u) => ({ sourceUrl: u, caption: null }))]
      .filter((p, i, all) => all.findIndex((q) => q.sourceUrl === p.sourceUrl) === i)
      .slice(0, 15);

    const listing: NormalizedListing & { address: string | null } = {
      externalId: `${h.hostelCode}:${slug(room.name)}`,
      externalUrl: h.url,
      type,
      title: `${h.name}: ${room.name}`,
      description: h.description,
      guestExpectations: null,
      houseRules:
        [
          ...h.basics,
          curfew ? `Curfew: ${curfew}` : null,
          quietHours ? `Quiet hours: ${quietHours}` : null,
          maxStayText ? `Max stay: ${maxStayText}` : null,
          residents ? `Residents: ${residents}` : null,
        ]
          .filter(Boolean)
          .join("\n") || null,
      neighborhood: null,
      city: a.addressLocality ?? null,
      subregion: (a.addressLocality && COUNTY[a.addressLocality]) ?? null,
      region: "California",
      countryCode: "US",
      lat: h.lat,
      lng: h.lng,
      locationPrecision: h.lat != null && h.lng != null ? "exact" : null,
      address,
      maxGuests: room.guests ?? room.beds ?? null,
      minNights: null,
      maxNights: maxStay ? Number(maxStay[1]) : null,
      // hiusa.org only shows rates inside its booking engine, which we don't touch.
      priceModel: "paid",
      priceAmountCents: null,
      pricePeriod: "night",
      currency: "USD",
      amenities: [...new Set(amenities)],
      languages: [],
      rating: null,
      attributes: {
        priceNote: "Rates are only shown in HI USA's booking engine (not scraped).",
        hostelCode: h.hostelCode,
        roomName: room.name,
        beds: room.beds,
        ensuite: room.ensuite,
        dorm: type === "shared_room",
        address,
        phone: h.telephone,
        checkIn,
        checkOut,
        petsAllowed: h.basics.some((b) => /pets not allowed/i.test(b)) ? false : null,
        maxStay: maxStayText,
        curfew,
        quietHours,
        minorsPolicy: minors,
        localResidentsRestricted: residents ? /only to travelers from outside|not (permitted|allowed)/i.test(residents) : null,
        residentsPolicy: residents,
        bookingUrl: `https://bookings.hiusa.org/booking-steps?hostelcode=${h.hostelCode}`,
        faqUrl: h.faqUrl,
        membershipNetwork: "Hostelling International",
      },
      host: {
        externalId: h.hostelCode,
        displayName: h.name,
        profileUrl: h.url,
      },
      photos,
      availability: [],
      raw: r,
    };
    return listing;
  },
};

export default hiusa;
