import type { NormalizedListing, SourceAdapter } from "./types";

/** One search-result card per listing, as written by scripts/scrapers/airbnb.node.ts. */
type Line = { type?: string | null; body?: string | null };
type AirbnbRaw = {
  id: string;
  url: string;
  searchedAt: string; // YYYY-MM-DD
  checkIn: string;
  checkOut: string;
  nights: number;
  query: { place: string; area: string; roomTypeFilter: string; priceMaxPerNight: number };
  result: {
    title?: string | null; // "Room in Oakland", "Guest suite in Outer Sunset", ...
    subtitle?: string | null; // Airbnb's (AI-generated) one-line summary
    nameLocalized?: { localizedStringWithTranslationPreference?: string | null } | null;
    avgRatingLocalized?: string | null; // "4.88 (603)" | "New"
    badges?: { text?: string | null }[] | null;
    paymentMessages?: { type?: string | null; text?: string | null }[] | null;
    contextualPictures?: { id?: string; picture?: string | null; caption?: string | null }[] | null;
    structuredContent?: { primaryLine?: Line[]; secondaryLine?: Line[] } | null;
    structuredDisplayPrice?: {
      primaryLine?: {
        price?: string | null;
        discountedPrice?: string | null;
        originalPrice?: string | null;
        qualifier?: string | null;
        accessibilityLabel?: string | null;
      } | null;
      explanationData?: {
        priceDetails?: { content?: string | null; items?: { description?: string | null }[] }[] | null;
      } | null;
    } | null;
    demandStayListing?: {
      location?: { coordinate?: { latitude?: number | null; longitude?: number | null } | null } | null;
      description?: { name?: { localizedStringWithTranslationPreference?: string | null } | null } | null;
    } | null;
  };
};

/** Bay Area towns that show up in Airbnb card titles → county. */
const COUNTY: Record<string, string> = {
  "San Francisco": "San Francisco County",
  "Daly City": "San Mateo County",
  "South San Francisco": "San Mateo County",
  "San Bruno": "San Mateo County",
  Millbrae: "San Mateo County",
  Burlingame: "San Mateo County",
  "San Mateo": "San Mateo County",
  Belmont: "San Mateo County",
  "San Carlos": "San Mateo County",
  "Redwood City": "San Mateo County",
  "Emerald Hills": "San Mateo County",
  "Menlo Park": "San Mateo County",
  "East Palo Alto": "San Mateo County",
  Pacifica: "San Mateo County",
  "Half Moon Bay": "San Mateo County",
  Brisbane: "San Mateo County",
  "Foster City": "San Mateo County",
  Oakland: "Alameda County",
  Berkeley: "Alameda County",
  Alameda: "Alameda County",
  Emeryville: "Alameda County",
  Albany: "Alameda County",
  "San Leandro": "Alameda County",
  "San Lorenzo": "Alameda County",
  "Castro Valley": "Alameda County",
  Hayward: "Alameda County",
  "Union City": "Alameda County",
  Fremont: "Alameda County",
  Newark: "Alameda County",
  Dublin: "Alameda County",
  Pleasanton: "Alameda County",
  Livermore: "Alameda County",
  "El Cerrito": "Contra Costa County",
  Richmond: "Contra Costa County",
  "San Pablo": "Contra Costa County",
  "El Sobrante": "Contra Costa County",
  Hercules: "Contra Costa County",
  Martinez: "Contra Costa County",
  Concord: "Contra Costa County",
  Clayton: "Contra Costa County",
  "Pleasant Hill": "Contra Costa County",
  "Walnut Creek": "Contra Costa County",
  Lafayette: "Contra Costa County",
  Orinda: "Contra Costa County",
  "San Ramon": "Contra Costa County",
  Danville: "Contra Costa County",
  Antioch: "Contra Costa County",
  Pittsburg: "Contra Costa County",
  "San Jose": "Santa Clara County",
  "Santa Clara": "Santa Clara County",
  Sunnyvale: "Santa Clara County",
  "Mountain View": "Santa Clara County",
  "Palo Alto": "Santa Clara County",
  "Los Altos": "Santa Clara County",
  Cupertino: "Santa Clara County",
  Campbell: "Santa Clara County",
  "Los Gatos": "Santa Clara County",
  Saratoga: "Santa Clara County",
  Milpitas: "Santa Clara County",
  "Morgan Hill": "Santa Clara County",
  "San Rafael": "Marin County",
  "San Quentin": "Marin County",
  Novato: "Marin County",
  "Mill Valley": "Marin County",
  Sausalito: "Marin County",
  "Corte Madera": "Marin County",
  Larkspur: "Marin County",
  Fairfax: "Marin County",
  "San Anselmo": "Marin County",
  Vallejo: "Solano County",
  Benicia: "Solano County",
  "Santa Cruz": "Santa Cruz County",
};

/** Rough San Francisco box, to tell SF neighborhoods ("Room in Outer Sunset") from towns. */
const inSF = (lat: number, lng: number) => lat >= 37.705 && lat <= 37.835 && lng >= -122.52 && lng <= -122.355;

const money = (s?: string | null) => {
  const n = s ? Number(s.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (s?: string | null) => s?.replace(/\s+/g, " ").trim() || null;

/** Card title prefix ("Room", "Shared room", "Guest suite", ...) → our listing type. */
function listingType(category: string): NormalizedListing["type"] {
  const c = category.toLowerCase();
  if (c.startsWith("shared room")) return "shared_room";
  if (c === "room" || c === "rooms" || c.startsWith("private room") || c.startsWith("hotel")) return "private_room";
  return "entire_place";
}

/** "1 queen bed", "2 beds", "1.5 shared baths", "Shared half-bath", "No bathroom". */
function bedBath(lines: Line[]) {
  const bed = lines.find((l) => l.type === "BEDINFO")?.body ?? null;
  const bath = lines.find((l) => l.type === "BATHROOMINFO")?.body ?? null;
  const beds = bed?.match(/^(\d+)\s/) ? Number(bed.match(/^(\d+)/)![1]) : null;
  const bathMatch = bath?.match(/^([\d.]+)\s/);
  const baths = bathMatch ? Number(bathMatch[1]) : /half-bath/i.test(bath ?? "") ? 0.5 : /no bathroom/i.test(bath ?? "") ? 0 : null;
  const bathPrivacy = /shared/i.test(bath ?? "") ? "shared" : /private/i.test(bath ?? "") ? "private" : null;
  return { bedInfo: bed, beds, bathInfo: bath, baths, bathPrivacy };
}

/** Amenities Airbnb's card summary or the listing name mention (cards carry no amenity list). */
const AMENITY_PATTERNS: [RegExp, string][] = [
  [/private (bath|bathroom|ba\b)|en[- ]?suite/i, "Private bathroom"],
  [/private (entrance|entry)/i, "Private entrance"],
  [/workspace|workstation|desk|office/i, "Workspace"],
  [/free parking|\bparking\b/i, "Parking"],
  [/kitchen(ette)?/i, "Kitchen"],
  [/wi-?fi/i, "Wi-Fi"],
  [/laundry|washer/i, "Laundry"],
  [/hot tub|jacuzzi/i, "Hot tub"],
  [/patio|deck|balcony/i, "Patio or balcony"],
  [/backyard|garden|yard/i, "Garden or backyard"],
  [/fire ?pit/i, "Fire pit"],
  [/\bev charger/i, "EV charger"],
];

/** "Milt recently lowered the price ..." is the only place a search card names the host. */
function hostFirstName(details: { content?: string | null }[]) {
  for (const d of details) {
    const name = d.content?.match(/^(.+?) recently lowered the price/)?.[1]?.trim();
    if (!name || /&|\b(properties|travel|llc|inc|homes|stays|rentals|group|team)\b/i.test(name)) continue;
    const first = name.split(/\s+/)[0];
    if (/^[A-Z][\p{L}'-]+$/u.test(first)) return first;
  }
  return null;
}

export const airbnb: SourceAdapter = {
  sourceId: "airbnb",

  normalize(input) {
    const r = input as AirbnbRaw;
    const c = r?.result;
    if (!r?.id || !c) return null;

    const priceLine = c.structuredDisplayPrice?.primaryLine;
    const total = money(priceLine?.discountedPrice ?? priceLine?.price);
    const nights = r.nights || 2;
    if (!total) return null;
    const originalTotal = money(priceLine?.originalPrice);
    const nightly = total / nights;

    const coord = c.demandStayListing?.location?.coordinate;
    const lat = coord?.latitude != null ? round2(coord.latitude) : null;
    const lng = coord?.longitude != null ? round2(coord.longitude) : null;

    const titleMatch = c.title?.match(/^(.+?) in (.+)$/);
    const category = titleMatch?.[1] ?? null;
    const place = titleMatch?.[2]?.trim() ?? null;
    const type = category ? listingType(category) : r.query.roomTypeFilter === "Entire home/apt" ? "entire_place" : "private_room";

    let city: string | null = null;
    let neighborhood: string | null = null;
    if (place && place !== "California") {
      if (COUNTY[place]) city = place;
      else if (coord?.latitude != null && coord.longitude != null && inSF(coord.latitude, coord.longitude)) {
        city = "San Francisco";
        neighborhood = place;
      } else city = place;
    }

    const name = clean(c.nameLocalized?.localizedStringWithTranslationPreference ?? c.demandStayListing?.description?.name?.localizedStringWithTranslationPreference);
    const summary = clean(c.subtitle);
    const lines = c.structuredContent?.primaryLine ?? [];
    const bb = bedBath(lines);
    const ratingMatch = c.avgRatingLocalized?.match(/^([\d.]+)(?:\s*\((\d[\d,]*)\))?/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : null;
    const reviewCount = ratingMatch?.[2] ? Number(ratingMatch[2].replace(/,/g, "")) : null;
    const badges = (c.badges ?? []).map((b) => b.text).filter(Boolean) as string[];
    const payments = (c.paymentMessages ?? []).map((m) => m.type).filter(Boolean) as string[];
    const priceDetails = c.structuredDisplayPrice?.explanationData?.priceDetails ?? [];
    const firstName = hostFirstName(priceDetails);

    const text = `${name ?? ""} ${summary ?? ""} ${bb.bathInfo ?? ""}`;
    // The card's bath line ("1 shared bath") beats keyword guesses about the bathroom.
    const keywords = AMENITY_PATTERNS.filter(([re]) => re.test(text))
      .map(([, label]) => label)
      .filter((a) => a !== "Private bathroom" || bb.bathPrivacy !== "shared");
    const bathAmenity = bb.bathPrivacy === "shared" ? "Shared bathroom" : bb.bathPrivacy === "private" ? "Private bathroom" : null;
    const amenities = [...new Set([bathAmenity, ...keywords].filter(Boolean) as string[])];

    const listing: NormalizedListing = {
      externalId: r.id,
      externalUrl: `https://www.airbnb.com/rooms/${r.id}`,
      type,
      title: name ?? c.title ?? `Airbnb listing ${r.id}`,
      description: summary,
      guestExpectations: null,
      houseRules: null,
      neighborhood,
      city,
      subregion: (city && COUNTY[city]) ?? null,
      region: "California",
      countryCode: "US",
      lat,
      lng,
      locationPrecision: lat != null && lng != null ? "approximate" : null,
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents: Math.round(nightly * 100),
      pricePeriod: "night",
      currency: "USD",
      amenities,
      languages: [],
      rating,
      attributes: {
        priceFromTotal: true,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        nights,
        totalPrice: total,
        originalTotalPrice: originalTotal,
        discounted: originalTotal != null && originalTotal > total,
        priceIncludesFees: true, // Airbnb US search shows all-in totals
        priceSeenAt: r.searchedAt,
        airbnbCategory: category, // "Room", "Guest suite", "Camper/RV", ...
        cardTitle: c.title ?? null,
        summaryIsAiGenerated: summary != null,
        reviewCount,
        isNew: c.avgRatingLocalized === "New",
        superhost: badges.includes("Superhost"),
        guestFavorite: badges.includes("Guest favorite"),
        badges,
        freeCancellation: payments.includes("FREE_CANCELLATION_HIGHLIGHT"),
        payZeroUpfront: payments.includes("PAY_ZERO_UPFRONT_HIGHLIGHT"),
        extendedStayDiscount: payments.includes("LENGTH_OF_STAY_CUSTOM_DURATION_DISCOUNT_HIGHLIGHT"),
        ...bb,
        hostFirstName: firstName,
        amenitiesFrom: "card summary and listing name (keyword match)",
        searchArea: r.query.area,
        searchFilter: { roomType: r.query.roomTypeFilter, priceMaxPerNight: r.query.priceMaxPerNight },
      },
      host: firstName ? { externalId: `listing:${r.id}`, displayName: firstName } : undefined,
      photos: (c.contextualPictures ?? [])
        .filter((p) => p.picture)
        .slice(0, 10)
        .map((p) => ({ sourceUrl: p.picture!, caption: p.caption ?? null })),
      availability: [
        {
          externalId: `${r.checkIn}_${r.checkOut}`,
          startDate: r.checkIn,
          endDate: r.checkOut,
          attributes: { nights, totalPrice: total, nightlyPrice: round2(nightly), currency: "USD", seenAt: r.searchedAt },
        },
      ],
      raw: r,
    };
    return listing;
  },
};

export default airbnb;
