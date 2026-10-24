import type { NormalizedListing, SourceAdapter } from "./types";

/** One public /rental/<id> page (see scripts/scrapers/sabbaticalhomes.node.ts). */
type SabbaticalHomesRaw = {
  id: string;
  scrapedAt?: string;
  url: string;
  badge: string | null;
  title: string | null;
  place: string | null; // "Berkeley, California, United States"
  priceLine: string | null; // "Rates from USD $3850"
  pricePeriod: string | null; // "Monthly" | "Weekly" | "Nightly" ...
  propertyType: string | null; // "House" | "Apartment" ...
  spaceType: string | null; // "Entire Home" | "Private Room" ...
  description: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  offices: string | null;
  size: string | null;
  suitedFor: string | null;
  availability: string[];
  minimumStay: string | null;
  closestUniversity: string | null;
  neighborhood: string | null;
  surroundings: string[];
  rates: string;
  considerations: string;
  features: Record<string, string[]>;
  smokingAllowed: string | null;
  petsAllowed: string | null;
  maxGuests: string | null;
  lat: number | null;
  lng: number | null;
  photos: string[];
  hostName: string | null;
  hostId: string | null;
  memberSince: string | null;
  trustScore: number | null;
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "November 23, 2026" -> "2026-11-23". */
function isoDate(s: string) {
  const m = s.trim().match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** "3 Months | Dates are flexible" -> 90 nights. */
function minNights(s: string | null) {
  const m = s?.match(/(\d+)\s*(night|day|week|month|year)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === "year" ? n * 365 : unit === "month" ? n * 30 : unit === "week" ? n * 7 : n;
}

const num = (s: string | null) => {
  const n = s ? Number.parseFloat(s.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

export const sabbaticalHomes: SourceAdapter = {
  sourceId: "sabbaticalhomes",

  normalize(input) {
    const r = input as SabbaticalHomesRaw;
    if (!r?.id || !r.title) return null;
    if (r.badge && !/RENT/i.test(r.badge)) return null; // rentals only, no exchanges

    const price = r.priceLine?.match(/([A-Z]{3})\s*\$?\s*([\d,]+(?:\.\d+)?)/);
    const period = r.pricePeriod?.toLowerCase() ?? "";
    const pricePeriod = /week/.test(period) ? "week" : /night|daily|day/.test(period) ? "night" : /month/.test(period) ? "month" : null;
    const space = r.spaceType?.toLowerCase() ?? "";
    const type = /shared/.test(space) ? "shared_room" : /room|private space/.test(space) ? "private_room" : "entire_place";

    const today = (r.scrapedAt ?? new Date().toISOString()).slice(0, 10);
    const availability: NormalizedListing["availability"] = [];
    const seen = new Set<string>();
    for (const line of r.availability ?? []) {
      // "From November 23, 2026", "From Now until May 1, 2027", "From Now Onwards"
      const m = line.match(/From (Now|[A-Za-z]+ \d{1,2}, \d{4})(?: until ([A-Za-z]+ \d{1,2}, \d{4}))?/);
      const start = m ? (m[1] === "Now" ? today : isoDate(m[1])) : null;
      if (!start || seen.has(line)) continue;
      seen.add(line);
      const end = m?.[2] ? isoDate(m[2]) : null;
      availability.push(
        end
          ? { startDate: start, endDate: end, attributes: { datesFlexible: /flexible/i.test(r.minimumStay ?? "") } }
          : { startDate: start, endDate: addMonths(start, 12), attributes: { openEnded: true } },
      );
    }

    const [city, region] = (r.place ?? "").split(",").map((s) => s.trim());
    const features = Object.values(r.features ?? {}).flat();
    const utilitiesIncluded = /Utilities are included/i.test(r.rates) ? true : /Utilities are not included/i.test(r.rates) ? false : null;

    const listing: NormalizedListing = {
      externalId: r.id,
      externalUrl: r.url,
      type,
      title: r.title,
      description: r.description,
      guestExpectations: null,
      houseRules: r.considerations || null,
      neighborhood: r.neighborhood,
      city: city || null,
      subregion: null,
      region: region || null,
      countryCode: "US",
      // Private homes: the site's own map pin is already jittered; round to ~1 km.
      lat: round2(r.lat),
      lng: round2(r.lng),
      locationPrecision: "approximate",
      maxGuests: num(r.suitedFor) ?? num(r.maxGuests),
      minNights: minNights(r.minimumStay),
      maxNights: null,
      priceModel: "paid",
      priceAmountCents: price ? Math.round(Number(price[2].replace(/,/g, "")) * 100) : null,
      currency: price?.[1] ?? "USD",
      pricePeriod,
      amenities: features,
      languages: [],
      rating: null,
      attributes: {
        priceIsFrom: true, // "Rates from"
        furnished: features.includes("Furnished") || null,
        utilitiesIncluded,
        cleaningIncluded: /cleaning service is included/i.test(r.rates) || null,
        bedrooms: num(r.bedrooms),
        bathrooms: num(r.bathrooms),
        offices: num(r.offices),
        size: r.size?.replace(/ft 2$/, "sq ft") ?? null,
        propertyType: r.propertyType,
        spaceType: r.spaceType,
        minStay: r.minimumStay?.split("|")[0].trim() ?? null,
        datesFlexible: /flexible/i.test(r.minimumStay ?? ""),
        closestUniversity: r.closestUniversity,
        surroundings: r.surroundings ?? [],
        petsAllowed: r.petsAllowed,
        smokingAllowed: r.smokingAllowed,
        hostTrustScore: r.trustScore,
        academicSublet: true,
      },
      host: r.hostId
        ? {
            externalId: r.hostId,
            displayName: r.hostName,
            profileUrl: null, // member profiles require login
            memberSince: r.memberSince ? new Date(`${r.memberSince}-01-01T00:00:00Z`) : null,
          }
        : undefined,
      photos: (r.photos ?? []).map((sourceUrl) => ({ sourceUrl })),
      availability,
      raw: { ...r, lat: round2(r.lat), lng: round2(r.lng) },
    };
    return listing;
  },
};

export default sabbaticalHomes;
