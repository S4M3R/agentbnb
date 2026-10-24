import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/spareroom.node.ts extracts per ad (list card + detail page). */
type Section = { heading: string | null; pairs: [string, string][]; items: string[] };
type SpareRoomRaw = {
  id: string;
  path: string;
  url: string;
  scrapedAt?: string;
  listingType: string | null; // "offered" | "wanted"
  brand?: string | null;
  daysOld?: number | null;
  availableNow?: boolean;
  status?: string | null;
  verified?: boolean;
  hasVideo?: boolean;
  neighbourhood?: string | null;
  postcode?: string | null;
  propertyType?: string | null;
  roomsInProperty?: number | null;
  advertiserRole?: string | null;
  headlineRate?: string | null;
  headlineRatePeriod?: string | null;
  cardTitle?: string | null;
  cardPrice?: string | null;
  cardRoomType?: string | null;
  shortDescription?: string | null;
  title: string | null;
  lat: number | null;
  lng: number | null;
  isExpired?: boolean;
  isNowLet?: boolean;
  description: string | null;
  keyFeatures: string[];
  sections: Record<string, Section>;
  photos: string[];
  advertiser?: { firstName: string | null; uuid: string | null; photo: string | null; role: string | null };
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const PERIODS: Record<string, "night" | "week" | "month"> = {
  monthly: "month", pcm: "month", month: "month", weekly: "week", pw: "week", week: "week", nightly: "night", night: "night",
};
const COUNTY_NAMES: Record<string, string> = {
  san_francisco: "San Francisco County",
  alameda_county: "Alameda County",
  contra_costa_county: "Contra Costa County",
  marin_county: "Marin County",
  napa_county: "Napa County",
  san_mateo_county: "San Mateo County",
  santa_clara_county: "Santa Clara County",
  santa_cruz_county: "Santa Cruz County",
  solano_county: "Solano County",
  sonoma_county: "Sonoma County",
};

/** Ad text shouldn't carry contact details; redact any phone numbers or emails that slip through. */
const redact = (s: string | null | undefined) =>
  s
    ?.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, "[phone removed]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email removed]") ?? null;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function pairs(raw: SpareRoomRaw, section: string) {
  return raw.sections?.[section]?.pairs ?? [];
}
function value(raw: SpareRoomRaw, section: string, key: RegExp) {
  return pairs(raw, section).find(([k]) => key.test(k))?.[1] ?? null;
}
const yesNo = (v: string | null) => (v == null ? null : /^yes\b/i.test(v) ? true : /^no\b/i.test(v) ? false : null);

/** "$1,300 monthly" / "$350 weekly" → cents + period. */
function parseRate(s: string | null | undefined) {
  if (!s) return null;
  const m = s.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s*)?([a-z]+)?/i);
  if (!m) return null;
  const amount = Math.round(Number(m[1].replace(/,/g, "")) * 100);
  const period = PERIODS[(m[2] ?? "monthly").toLowerCase()] ?? "month";
  return Number.isFinite(amount) && amount > 0 ? { amountCents: amount, period } : null;
}

/** "Available now" / "1 Nov 2026" / "Nov 1, 2026" → YYYY-MM-DD. */
function parseAvailable(s: string | null, today: string) {
  if (!s || /now/i.test(s)) return today;
  const dmy = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  const mdy = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  let y: number | undefined, mo: number | undefined, d: number | undefined;
  if (dmy && MONTHS[dmy[2].toLowerCase()]) [d, mo, y] = [Number(dmy[1]), MONTHS[dmy[2].toLowerCase()], Number(dmy[3])];
  else if (mdy && MONTHS[mdy[1].toLowerCase()]) [mo, d, y] = [MONTHS[mdy[1].toLowerCase()], Number(mdy[2]), Number(mdy[3])];
  if (!y || !mo || !d) return today;
  const date = iso(new Date(Date.UTC(y, mo - 1, d)));
  return date < today ? today : date;
}

/** "1 month" / "6 months" / "1 year" / "2 weeks" → nights. */
function termNights(s: string | null) {
  if (!s || /none/i.test(s)) return null;
  const m = s.match(/(\d+)\s*(day|week|month|year)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return { day: n, week: n * 7, month: n * 30, year: n * 365 }[m[2].toLowerCase() as "day"] ?? null;
}

export const spareroom: SourceAdapter = {
  sourceId: "spareroom",

  normalize(input) {
    const r = input as SpareRoomRaw;
    if (!r?.id || !r.url) return null;
    // Only ads offering a place; skip "room wanted" ads and ads already let/expired.
    if (r.listingType !== "offered" || r.isExpired || r.isNowLet) return null;

    const now = r.scrapedAt ? new Date(r.scrapedAt) : new Date();
    const today = iso(now);

    // Rooms: [["$1,000 monthly", "large (Private bathroom)"], ...]. Whole-place ads carry the
    // rent in the section heading instead: "$2,500 monthly (whole property)".
    const sections = r.sections ?? {};
    const wholeSection = sections["price-whole-property"] ?? null;
    const rooms = pairs(r, "price_room_only").map(([price, desc]) => {
      const rate = parseRate(price);
      return {
        price,
        description: desc || null,
        amountCents: rate?.amountCents ?? null,
        period: rate?.period ?? null,
        rented: /now rented/i.test(desc),
        privateBathroom: /private bath|ensuite|en-suite/i.test(desc),
        shared: /\bshared\b|twin/i.test(desc),
      };
    });
    const openRooms = rooms.filter((x) => !x.rented);
    // Every room in the ad is already taken.
    if (rooms.length && !openRooms.length) return null;

    const cheapest = openRooms
      .filter((x) => x.amountCents != null)
      .sort((a, b) => a.amountCents! - b.amountCents!)[0];
    const rate =
      (cheapest ? { amountCents: cheapest.amountCents!, period: cheapest.period! } : null) ??
      parseRate(wholeSection?.heading) ??
      parseRate(r.headlineRate ? `${r.headlineRate} ${r.headlineRatePeriod ?? ""}` : r.cardPrice);

    // "House share" / "Apartment share" / "Shared property" / "Apartment to rent" / "House to rent".
    const kind = r.keyFeatures?.[0] ?? null;
    const wholePlace = wholeSection != null || /to rent|whole|entire/i.test(kind ?? "");
    const allShared = openRooms.length > 0 && openRooms.every((x) => x.shared);
    const type = wholePlace ? "entire_place" : allShared ? "shared_room" : "private_room";

    // Location: path is /rooms-for-rent/<county or san_francisco>/<neighbourhood>/<id>.
    const [, area, hood] = r.path.split("/").filter(Boolean);
    const inSf = area === "san_francisco";
    const place = r.neighbourhood || (hood ? titleCase(hood) : null);
    const round = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

    // Ads that redirect off-site (operators) only have the list card: "1 room - Available Dec 4 2026".
    const availableText =
      value(r, "availability", /^Available$/i) ?? r.cardRoomType?.match(/Available (.+)$/)?.[1] ?? null;
    const available = parseAvailable(availableText, today);
    const end = new Date(Date.parse(available) + 365 * 864e5);
    const minTerm = value(r, "availability", /Minimum term/i);
    const maxTerm = value(r, "availability", /Maximum term/i);

    const amenityPairs = pairs(r, "amenities");
    const amenities = amenityPairs
      .filter(([k, v]) => k !== "Furnishings" && /^(yes|shared|own)/i.test(v))
      .map(([k, v]) => (/^yes/i.test(v) ? k : `${k}: ${v}`));
    const furnishings = value(r, "amenities", /Furnishings/i);
    const deposits = pairs(r, "extra-cost")
      .filter(([k]) => /deposit/i.test(k))
      .map(([k, v]) => ({ label: k, amount: v }));
    const household = Object.fromEntries(pairs(r, "current-household").map(([k, v]) => [k.replace(/\s+/g, " "), v]));
    const preferences = Object.fromEntries(pairs(r, "household-preferences"));

    const listing: NormalizedListing = {
      externalId: String(r.id),
      externalUrl: r.url,
      type,
      title: redact(r.title || r.cardTitle || `Room in ${place ?? "the Bay Area"}`)!.trim(),
      description: redact(r.description || r.shortDescription),
      guestExpectations: null,
      houseRules: null,
      neighborhood: inSf ? place : null,
      city: inSf ? "San Francisco" : place,
      subregion: COUNTY_NAMES[area] ?? (area ? titleCase(area) : null),
      region: "California",
      countryCode: "US",
      // The pin may be the actual home: keep it to ~1 km.
      lat: round(r.lat),
      lng: round(r.lng),
      locationPrecision: r.lat != null ? "approximate" : null,
      maxGuests: null,
      minNights: termNights(minTerm),
      maxNights: termNights(maxTerm),
      priceModel: "paid",
      priceAmountCents: rate?.amountCents ?? null,
      pricePeriod: rate?.period ?? null,
      currency: "USD",
      amenities,
      languages: [],
      rating: null,
      attributes: {
        propertyKind: kind,
        propertyType: r.propertyType ?? null,
        postcode: r.postcode ?? null,
        rooms: openRooms.map(({ rented: _r, ...x }) => x),
        roomsAvailable: wholePlace ? null : openRooms.length || null,
        roomsRented: rooms.length - openRooms.length,
        unitType: wholePlace ? (r.cardRoomType?.split(" - ")[0] ?? null) : null,
        suggestedRentSplit: sections["suggested-rent"]?.pairs ?? null,
        offsiteAd: !Object.keys(sections).length,
        roomsInProperty: r.roomsInProperty ?? null,
        minTerm,
        maxTerm,
        shortLetsConsidered: sections.availability?.items?.some((i) => /short/i.test(i)) ?? false,
        weekdaysOnly: sections.availability?.items?.some((i) => /Monday to Friday/i.test(i)) ?? false,
        availabilityNotes: sections.availability?.items ?? [],
        deposit: deposits[0]?.amount ?? null,
        deposits,
        billsIncluded: yesNo(value(r, "extra-cost", /Utilities included|Bills included/i)),
        feesApply: yesNo(value(r, "extra-cost", /Fees apply/i)),
        furnished: furnishings ? !/unfurnished/i.test(furnishings) : null,
        furnishings,
        household,
        roommatePreferences: preferences,
        advertiserRole: r.advertiser?.role ?? r.advertiserRole ?? null,
        verified: r.verified ?? null,
        featured: r.brand === "featured",
        hasVideo: r.hasVideo ?? null,
        daysOld: r.daysOld ?? null,
        postedAt: r.daysOld != null ? iso(new Date(now.getTime() - r.daysOld * 864e5)) : null,
      },
      host: r.advertiser?.uuid
        ? {
            externalId: r.advertiser.uuid,
            displayName: r.advertiser.firstName,
            avatarUrl: r.advertiser.photo,
          }
        : undefined,
      photos: (r.photos ?? []).map((url) => ({ sourceUrl: url })),
      availability: [
        {
          externalId: null,
          startDate: available,
          endDate: iso(end),
          attributes: { openEnded: true, availableNow: available === today, availableText },
        },
      ],
      // Keep the raw ad minus the exact pin.
      raw: {
        ...r,
        lat: round(r.lat),
        lng: round(r.lng),
        description: redact(r.description),
        shortDescription: redact(r.shortDescription),
      },
    };
    return listing;
  },
};

export default spareroom;
