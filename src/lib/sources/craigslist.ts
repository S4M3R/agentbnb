import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/craigslist.node.ts extracts per post (search card + detail page). */
type CraigslistRaw = {
  category: "roo" | "sub";
  slug: string;
  url: string;
  title: string;
  listPrice: string | null;
  listLocation: string | null;
  listLat?: number | null;
  listLng?: number | null;
  scrapedAt?: string;
  removed?: boolean;
  postId: string | null;
  price: string | null;
  housing: string | null;
  hood: string | null;
  city: string | null;
  postalCode: string | null;
  subarea: string | null;
  subareaName: string | null;
  lat: number | null;
  lng: number | null;
  mapAccuracy: number | null;
  important: string[];
  attrs: { key: string | null; label: string | null; value: string }[];
  petsAllowed: boolean | null;
  smokingAllowed: boolean | null;
  bedrooms: number | null;
  bathrooms: number | null;
  description: string | null;
  photos: string[];
  postedAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
};

const SUBAREAS: Record<string, string> = {
  sfc: "San Francisco",
  eby: "East Bay",
  sby: "South Bay",
  pen: "Peninsula",
  nby: "North Bay",
  scz: "Santa Cruz",
};
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DAY_RE = "(\\d{1,2})(?:st|nd|rd|th)?";
const YEAR_RE = "(?:,?\\s*(20\\d\\d))?";

/** Posts shouldn't carry contact details; redact any phone numbers or emails that slip through. */
const redact = (s: string | null | undefined) =>
  s
    ?.replace(/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g, "[phone removed]")
    .replace(/\b\d{10}\b/g, "[phone removed]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email removed]")
    .replace(/\bshow contact info\b/gi, "")
    .replace(/QR Code Link to This Post\s*/g, "")
    .trim() ?? null;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(Date.parse(date) + days * 864e5));
const round = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

/** Seeking-a-place ads (the scraper already drops most of them). "Looking for a roommate" is an offer. */
const OFFER_TARGET =
  /^\W*(a |an |another |new |my |our |one |the |\d+ )?(\w+ )?(room ?mates?|house ?mates?|flat ?mates?|tenants?|person|people|someone|subletters?|sublessors?|renters?|lodgers?|guests?)\b/i;
function isWanted(title: string) {
  const t = title.replace(/^[^\p{L}]+/u, "");
  const lead = t.match(/^(wanted|looking for|looking to rent|seeking|searching for|in search of|iso)\b:?(.*)$/i);
  if (lead) return !OFFER_TARGET.test(lead[2]);
  return (
    /\b(room|place|sublet|housing|apartment|studio|home) wanted\b/i.test(t) ||
    /\bneed(ing|s)? (a |an )?(temporary |short[- ]term )?(room|place|sublet|housing|studio)\b/i.test(t) ||
    /\b(tattoo|salon|esthetician|nail tech|office space|commercial)\b/i.test(t)
  );
}

/** Month/day (+ optional year) → YYYY-MM-DD, picking the year that puts it near `ref`. */
function toDate(month: string, day: string, year: string | undefined, ref: string) {
  const mo = MONTHS[month.slice(0, 3).toLowerCase()];
  const d = Number(day);
  if (!mo || !d || d > 31) return null;
  const refYear = Number(ref.slice(0, 4));
  let y = year ? Number(year) : refYear;
  let date = iso(new Date(Date.UTC(y, mo - 1, d)));
  // "available jan 5" posted in October means next January.
  if (!year && Date.parse(date) < Date.parse(ref) - 60 * 864e5) {
    y++;
    date = iso(new Date(Date.UTC(y, mo - 1, d)));
  }
  return date;
}

/** "November 1 - December 23", "Dec 15 - Jan 31st", "Nov 1-15", "11/1 - 12/23", "through Dec 31". */
function parseRange(s: string | null | undefined, ref: string) {
  if (!s) return null;
  const sep = "\\s*(?:-|–|—|to|through|thru|until|till)\\s*";
  const words = new RegExp(`\\b${MONTH_RE}\\s+${DAY_RE}${YEAR_RE}${sep}(?:${MONTH_RE}\\s+)?${DAY_RE}\\b${YEAR_RE}`, "i");
  const m = s.match(words);
  if (m) {
    const start = toDate(m[1], m[2], m[3], ref);
    if (!start) return null;
    let end = toDate(m[4] ?? m[1], m[5], m[6] ?? m[3], start);
    if (end && end < start) end = toDate(m[4] ?? m[1], m[5], String(Number(start.slice(0, 4)) + 1), start);
    return start && end && end > start ? { start, end } : null;
  }
  const nums = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(?:20)?(\d\d))?\s*(?:-|–|—|to|through|thru|until)\s*(\d{1,2})\/(\d{1,2})(?:\/(?:20)?(\d\d))?\b/);
  if (nums && Number(nums[1]) <= 12 && Number(nums[4]) <= 12) {
    const name = (n: string) => Object.keys(MONTHS)[Number(n) - 1];
    const start = toDate(name(nums[1]), nums[2], nums[3] ? `20${nums[3]}` : undefined, ref);
    const end = start && toDate(name(nums[4]), nums[5], nums[6] ? `20${nums[6]}` : undefined, start);
    return start && end && end > start ? { start, end } : null;
  }
  const until = s.match(new RegExp(`\\b(?:until|through|thru|ends?|ending|till)\\s+(?:${MONTH_RE}\\s+)${DAY_RE}${YEAR_RE}`, "i"));
  if (until) {
    const end = toDate(until[1], until[2], until[3], ref);
    return end ? { start: null, end } : null;
  }
  return null;
}

/** Not a place to live: commercial space, services, or personals posted in housing. */
const NOT_HOUSING =
  /\b(warehouse|storage|storefront|retail|workshop space|photo studio|office space|commercial space|host manager|rental management)\b/i;
const PERSONALS = /\bdaddy dom\b|\bsugar (daddy|baby)\b/i;

const money = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
/** Posts with no price field usually state it in the title or body: "$850", "$3,500/month", "$3,400 for entire period". */
function priceFromText(title: string, desc: string) {
  const stay = /\$\s*([\d,]{3,})(?:\.\d\d)?\s*(?:for (?:the )?(?:entire|whole|full)|total)\b/i;
  const monthly = /\$\s*([\d,]{3,})(?:\.\d\d)?\s*(?:\/|per |a )\s*(?:mo|month)\b/i;
  const any = /\$\s*([\d,]{3,})(?:\.\d\d)?\b/;
  for (const s of [title, desc.slice(0, 1500)]) {
    const m = s.match(stay);
    if (m) return { cents: money(m[1]), period: "stay" as const };
    const mo = s.match(monthly);
    if (mo) return { cents: money(mo[1]), period: "month" as const };
  }
  const m = title.match(any) ?? desc.slice(0, 1500).match(any);
  return m ? { cents: money(m[1]), period: "month" as const } : null;
}

const PARKING = /carport|garage|off-street parking|street parking|valet parking|no parking/i;
const LAUNDRY = /w\/d in unit|w\/d hookups|laundry in bldg|laundry on site|no laundry on site/i;
const HOUSING_TYPES =
  /^(apartment|condo|cottage\/cabin|duplex|flat|house|in-law|loft|townhouse|manufactured|assisted living|land)$/i;

export const craigslist: SourceAdapter = {
  sourceId: "craigslist",

  normalize(input) {
    const r = input as CraigslistRaw;
    if (!r?.url || r.removed) return null;
    const title = r.title?.trim() || "";
    if (isWanted(title) || NOT_HOUSING.test(title) || PERSONALS.test(r.description ?? "")) return null;

    const now = r.scrapedAt ? new Date(r.scrapedAt) : new Date();
    const today = iso(now);

    const values = (r.attrs ?? []).map((a) => a.value);
    const has = (re: RegExp) => values.some((v) => re.test(v));
    const rentPeriod = r.attrs?.find((a) => a.label === "rent period")?.value ?? null;
    const housingType = values.find((v) => HOUSING_TYPES.test(v)) ?? null;
    const laundry = values.find((v) => LAUNDRY.test(v)) ?? null;
    const parking = values.find((v) => PARKING.test(v)) ?? null;
    const furnished = has(/^furnished$/i);
    const privateBath = has(/^private bath$/i) ? true : has(/^no private bath$/i) ? false : null;
    const privateRoomAttr = has(/^private room$/i) ? true : has(/^room not private$/i) ? false : null;

    // "1BR / sharedBa", "2BR / 1.5Ba", "500ft2", "available nov 1".
    const chips = r.important ?? [];
    const brBa = chips.map((c) => c.match(/(\d+)BR\s*\/\s*(shared|[\d.]+)Ba/i)).find(Boolean);
    const bedrooms = brBa ? Number(brBa[1]) : r.bedrooms;
    const sharedBath = brBa ? /shared/i.test(brBa[2]) : null;
    const bathrooms = brBa && !sharedBath ? Number(brBa[2]) : r.bathrooms;
    const sqft = Number(chips.map((c) => c.match(/(\d[\d,]*)\s*ft2/i)?.[1]).find(Boolean)?.replace(/,/g, "")) || null;
    const availableText = chips.find((c) => /^available/i.test(c)) ?? null;

    // Type: rooms & shares are rooms (shared when the bedroom itself is shared). Sublets are
    // whole places unless the post reads like a room in someone's home. Craigslist's own
    // "private room" flag is set on most sublets, whole flats included, so it can't decide this.
    const desc = r.description ?? "";
    const head = `${title}\n${desc.slice(0, 600)}`;
    const sharedRoom = /\bshared (bed)?room\b|\bbunk ?beds?\b|\bshare (a|the|my) (bed)?room\b|\broom not private\b/i.test(
      `${head}\n${privateRoomAttr === false ? "room not private" : ""}`,
    );
    const roomTitle = (s: string) =>
      roomish(s) ||
      (/\b(rm|room|backroom)\b/i.test(s) && !/\b(studio|apartment|apt|cottage|condo|in-law|entire|whole|suite)\b/i.test(s));
    const roomish = (s: string) =>
      /\b(bed|back)?rooms? (in|for rent|available|for sublet|to sublet|sublet|for lease)\b|\b(private|furnished|spare|master|large|cozy|sunny|bright) (bed)?room\b|\broom ?mates?\b|\bhouse ?mates?\b|\bco-?living\b|\bshared (kitchen|bath|bathroom|living|common)\b/i.test(
        s,
      );
    const entireish =
      /\b(entire|whole|studio|in-law|inlaw|cottage|condo|apartment|apt|flat|house|home|suite|unit|loft|townhouse|cabin|guesthouse|guest house|adu|\d\s*(br|bd|bed|bedroom)s?)\b/i;
    let type: NormalizedListing["type"];
    if (r.category === "roo") type = sharedRoom ? "shared_room" : "private_room";
    else if (sharedRoom) type = "shared_room";
    else if (roomTitle(title) || sharedBath) type = "private_room";
    else if (entireish.test(title)) type = "entire_place";
    else type = roomish(desc.slice(0, 600)) ? "private_room" : "entire_place";

    // Price: "$1,650". Period from the "rent period" attr, overridden by an explicit unit next to
    // that amount in the title ("From $104/nt or $567/wk"). No price field → read it from the text.
    const amount = Number((r.price ?? r.listPrice ?? "").replace(/[^\d.]/g, ""));
    const fromText = !(amount > 0) ? priceFromText(title, desc) : null;
    let priceAmountCents = amount > 0 ? Math.round(amount * 100) : (fromText?.cents ?? null);
    let pricePeriod: "night" | "week" | "month" | "stay" =
      fromText?.period ??
      (rentPeriod && /week/i.test(rentPeriod) ? "week" : rentPeriod && /dai|night/i.test(rentPeriod) ? "night" : "month");
    const amountText = amount > 0 ? Math.round(amount).toLocaleString("en-US").replace(/,/g, ",?") : null;
    const unit = amountText
      ? title.match(new RegExp(`\\$\\s*${amountText}(?:\\.\\d\\d)?\\s*(?:\\/|per |a )\\s*(wk|week|nt|night|day|mo|month)\\b`, "i"))?.[1]
      : null;
    if (unit) pricePeriod = /^(wk|week)/i.test(unit) ? "week" : /^(nt|night|day)/i.test(unit) ? "night" : "month";
    else if (!fromText && /\bweekly\b/i.test(title) && !/monthly/i.test(title)) pricePeriod = "week";
    else if (!fromText && /\bnightly\b/i.test(title)) pricePeriod = "night";
    // "$1" placeholders aren't prices.
    if (priceAmountCents != null && priceAmountCents < (pricePeriod === "night" ? 2000 : 5000)) priceAmountCents = null;

    // Availability: stated start ("available now" / "available nov 1") to a stated end (common on
    // sublets: "Nov 1 - Dec 23"), else open-ended for a year.
    const availRe = new RegExp(`\\bavail(?:able|\\.)?\\s+(?:from\\s+|starting\\s+|on\\s+)?${MONTH_RE}\\s+${DAY_RE}${YEAR_RE}`, "i");
    const avail = availableText?.match(availRe) ?? title.match(availRe) ?? desc.slice(0, 1500).match(availRe);
    let start = avail ? toDate(avail[1], avail[2], avail[3], today) : today;
    const range = parseRange(title, today) ?? (r.category === "sub" ? parseRange(desc.slice(0, 1500), today) : null);
    if (!avail && range?.start) start = range.start;
    if (!start || start < today) start = today;
    const end = range && range.end > start ? range.end : null;
    // A short stay quoted without a rent period is the price of the whole stay
    // ("Thanksgiving week sublet 11/22-11/29, $900").
    if (end && !rentPeriod && !fromText && pricePeriod === "month" && Date.parse(end) - Date.parse(start) <= 31 * 864e5) {
      pricePeriod = "stay";
    }

    const inSf = r.subarea === "sfc" || /^san francisco$/i.test(r.city ?? "");
    const amenities = [
      furnished && "Furnished",
      privateBath && "Private bathroom",
      laundry && !/^no /i.test(laundry) && (/w\/d in unit/i.test(laundry) ? "Washer/dryer in unit" : `Laundry: ${laundry}`),
      parking && !/^no /i.test(parking) && `Parking: ${parking}`,
      has(/air conditioning/i) && "Air conditioning",
      has(/wheelchair accessible/i) && "Wheelchair accessible",
      has(/EV charging/i) && "EV charging",
      has(/cats are OK/i) && "Cats OK",
      has(/dogs are OK/i) && "Dogs OK",
    ].filter((x): x is string => typeof x === "string");

    const listing: NormalizedListing = {
      externalId: r.postId ?? r.slug,
      externalUrl: r.url,
      type,
      title: redact(title) || `Room in ${r.city ?? "the Bay Area"}`,
      description: redact(r.description),
      guestExpectations: null,
      houseRules: has(/no smoking/i) ? "No smoking" : null,
      neighborhood: inSf ? r.hood : null,
      city: r.city ?? (inSf ? "San Francisco" : null),
      subregion: (r.subarea && SUBAREAS[r.subarea]) ?? null,
      region: "California",
      countryCode: "US",
      // Craigslist pins are already fuzzed; round further to ~1 km.
      lat: round(r.lat ?? r.listLat),
      lng: round(r.lng ?? r.listLng),
      locationPrecision: (r.lat ?? r.listLat) != null ? "approximate" : null,
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents,
      pricePeriod: priceAmountCents ? pricePeriod : null,
      currency: "USD",
      amenities,
      languages: [],
      rating: null,
      attributes: {
        category: r.category === "roo" ? "rooms & shares" : "sublets & temporary",
        postId: r.postId,
        postedAt: r.postedAt,
        updatedAt: r.updatedAt,
        expiresAt: r.expiresAt,
        areaLabel: r.hood ?? r.listLocation,
        postalCode: r.postalCode,
        housingType,
        bedrooms: bedrooms ?? null,
        bathrooms: bathrooms ?? null,
        sharedBath,
        sqft,
        rentPeriod,
        priceFromText: fromText != null,
        furnished,
        privateRoom: privateRoomAttr,
        privateBath,
        laundry,
        parking,
        catsOk: has(/cats are OK/i),
        dogsOk: has(/dogs are OK/i),
        noSmoking: has(/no smoking/i),
        wheelchairAccessible: has(/wheelchair accessible/i),
        airConditioning: has(/air conditioning/i),
        evCharging: has(/EV charging/i),
        availableText,
        statedEndDate: end,
      },
      photos: (r.photos ?? []).map((url) => ({ sourceUrl: url, width: 600, height: 450 })),
      availability: [
        end
          ? { externalId: null, startDate: start, endDate: end, attributes: { openEnded: false, availableText } }
          : {
              externalId: null,
              startDate: start,
              endDate: addDays(start, 365),
              attributes: { openEnded: true, availableNow: start === today, availableText },
            },
      ],
      // Keep the raw post minus the precise pin.
      raw: {
        ...r,
        lat: round(r.lat),
        lng: round(r.lng),
        listLat: round(r.listLat),
        listLng: round(r.listLng),
        title: redact(r.title),
        description: redact(r.description),
      },
    };
    return listing;
  },
};

export default craigslist;
