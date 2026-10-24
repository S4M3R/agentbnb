import type { NormalizedListing, SourceAdapter } from "./types";

type Money = { amount: number; currency: string };

/** One home from Blueground's city page state, plus a 12-month price quote (see scripts/scrapers/blueground.node.ts). */
type BluegroundRaw = {
  id: number;
  code: string;
  name?: string | null;
  path: string;
  businessModel?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  hasJuniorBedroom?: boolean;
  lotSize?: number | null; // sq ft
  address?: { lat?: number; lng?: number; city?: string | null; area?: string | null; level2?: string | null; building?: string | null } | null;
  availableFrom?: string | null;
  cityCode?: string | null;
  highestFloor?: number | null;
  utilities?: { name: string }[];
  utilitiesIncludedInRent?: boolean;
  photos?: { url: string; captionKey?: string | null; tags?: string[] }[];
  rent?: { minDuration?: { start?: string; end?: string; months?: number; days?: number } | null } | null;
  isPopular?: boolean;
  quote?: { checkIn: string; checkOut: string; rent: Money; baseRent?: Money | null; minStayQuote?: boolean } | null;
};

const UTILITY_NAMES: Record<string, string> = {
  TELCO: "Internet",
  LIVE_TV: "TV",
  NATURAL_GAS: "Gas",
  POWER: "Electricity",
  WATER: "Water",
  HEATING: "Heating",
};

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const round3 = (n?: number | null) => (n == null ? null : Math.round(n * 1000) / 1000);
/** "masterBr" -> "Master br", "buildingsSwimmingPool" -> "Buildings swimming pool". */
const caption = (key?: string | null) =>
  key ? key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null;

export const blueground: SourceAdapter = {
  sourceId: "blueground",

  normalize(input) {
    const p = input as BluegroundRaw;
    if (!p?.id || !p.path) return null;

    const beds = p.bedrooms ?? null;
    const bedLabel = beds === 0 ? "studio" : beds ? `${p.hasJuniorBedroom && beds === 1 ? "Jr. " : ""}${beds}BR apartment` : "apartment";
    const area = p.address?.level2 ?? null;
    const city = p.address?.city ?? null;
    const minStay = p.rent?.minDuration;
    // rent.minDuration is the default stay window the card quotes, not a minimum;
    // Blueground rents "for monthly stays or longer".
    const defaultQuoteNights =
      minStay?.start && minStay?.end
        ? Math.round((Date.parse(minStay.end) - Date.parse(minStay.start)) / 86_400_000)
        : null;
    const utilities = (p.utilities ?? []).map((u) => UTILITY_NAMES[u.name] ?? u.name);
    const photoTags = new Set((p.photos ?? []).map((ph) => ph.captionKey ?? ""));
    const buildingAmenities = [
      photoTags.has("buildingsSwimmingPool") && "Pool",
      photoTags.has("buildingsFitnessCenter") && "Gym",
      photoTags.has("buildingsCourtyard") && "Courtyard",
      photoTags.has("buildingsBbq") && "BBQ area",
      photoTags.has("buildingsRooftop") && "Rooftop",
      photoTags.has("buildingsLounge") && "Lounge",
    ].filter((a): a is string => Boolean(a));
    const start = p.availableFrom ?? minStay?.start ?? null;

    const listing: NormalizedListing = {
      externalId: `${p.cityCode ?? "SFO"}-${p.code}`,
      externalUrl: `https://www.theblueground.com/${p.path}`,
      type: "entire_place",
      title: `Furnished ${bedLabel}${area ? ` in ${area}` : ""}${city && city !== area ? `, ${city}` : ""}`.replace(
        /Furnished studio/,
        "Furnished studio apartment",
      ),
      description:
        `Fully furnished, move-in ready ${beds === 0 ? "studio" : `${beds}-bedroom`} apartment managed by Blueground` +
        `${p.lotSize ? ` (${p.lotSize} sq ft)` : ""}. Monthly and long-term stays` +
        `${p.utilitiesIncludedInRent ? `; utilities (${utilities.join(", ")}) included` : ""}.`,
      guestExpectations: null,
      houseRules: null,
      neighborhood: area,
      city,
      subregion: null,
      region: "CA",
      countryCode: "US",
      // Managed apartment buildings; rounded, street address not kept.
      lat: round3(p.address?.lat),
      lng: round3(p.address?.lng),
      locationPrecision: "approximate",
      maxGuests: null,
      minNights: 30,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents: p.quote?.rent?.amount ? Math.round(p.quote.rent.amount * 100) : null,
      currency: p.quote?.rent?.currency ?? "USD",
      pricePeriod: "month",
      amenities: [
        "Furnished",
        ...(p.utilitiesIncludedInRent ? utilities.map((u) => `${u} included`) : []),
        ...buildingAmenities,
      ],
      languages: [],
      rating: null,
      attributes: {
        priceIsFrom: true,
        priceQuote: p.quote
          ? { checkIn: p.quote.checkIn, checkOut: p.quote.checkOut, minStayQuote: p.quote.minStayQuote ?? false }
          : null,
        baseRentMonthly: p.quote?.baseRent?.amount ?? null,
        furnished: true,
        utilitiesIncluded: p.utilitiesIncludedInRent ?? null,
        utilities,
        bedrooms: beds,
        juniorBedroom: p.hasJuniorBedroom ?? false,
        bathrooms: p.bathrooms ?? null,
        squareFeet: p.lotSize ?? null,
        buildingFloors: p.highestFloor ?? null,
        minStay: "1 month",
        defaultQuoteNights,
        buildingAmenities,
        businessModel: p.businessModel ?? null,
        popular: p.isPopular ?? false,
        unitCode: p.code,
      },
      photos: (p.photos ?? []).map((ph) => ({
        sourceUrl: ph.url,
        caption: caption(ph.captionKey),
      })),
      availability: start ? [{ startDate: start, endDate: addMonths(start, 12), attributes: { openEnded: true } }] : [],
      raw: {
        ...p,
        name: undefined,
        address: { ...p.address, building: undefined, lat: round3(p.address?.lat), lng: round3(p.address?.lng) },
      },
    };
    return listing;
  },
};

export default blueground;
