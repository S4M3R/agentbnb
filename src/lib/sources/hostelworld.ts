import type { NormalizedListing, SourceAdapter } from "./types";

/** One item per property per room category, as written by scripts/scrapers/hostelworld.node.ts. */
type HostelworldRaw = {
  category: "dorm" | "private";
  url: string;
  seenAt: string; // YYYY-MM-DD
  priceFrom: { value: number; currency: string };
  /** "listed" = the property's public "from" price; "weekend_availability" = lowest weekend price seen. */
  priceFromSource?: "listed" | "weekend_availability";
  listedPriceFrom?: { value: number; currency: string } | null;
  /** Optional date pass: this category's availability for the next few weekends (Fri-Sun). */
  weekends?: {
    checkIn: string; // YYYY-MM-DD (Friday)
    checkOut: string; // YYYY-MM-DD (Sunday)
    nights: number;
    guests: number;
    checkedAt: string;
    available: boolean;
    lowestPricePerNight: { value: number; currency: string } | null;
    averagePricePerNight: { value: number; currency: string } | null;
    rooms: {
      name: string | null;
      basicType: string | null;
      capacity: number | null;
      ensuite: boolean;
      bedsAvailable: number | null;
      roomsAvailable: number | null;
      lowestPricePerNight: { value: number; currency: string } | null;
      averagePricePerNight: { value: number; currency: string } | null;
      totalPrice: { value: number; currency: string } | null;
    }[];
  }[];
  property: {
    id: number;
    name: string;
    type: string; // HOSTEL | HOTEL | ...
    address?: string | null;
    city?: string | null;
    avgRating?: number | null; // 0-10
    numberReviews?: number | null;
    cityCenterDistance?: number | null; // km
    hasAvailability?: boolean | null;
    isNew?: boolean | null;
    badges?: string[];
    intro?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    averageRatings?: Record<string, number> | null;
    minDormPrice?: { value: number; currency: string } | null;
    minPrivatePrice?: { value: number; currency: string } | null;
    images?: string[];
  };
  detail: {
    type?: string | null;
    isActive?: boolean | null;
    description?: string | null;
    address1?: string | null;
    address2?: string | null;
    postalCode?: string | null;
    region?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    maxGuestsPerBooking?: number | null;
    reviewCount?: number | null;
    houseRules: {
      notes?: string | null;
      checkin?: { from?: number | null; until?: number | null } | null;
      latestCheckout?: string | null;
      cancellationPolicy?: { canxDays?: number; freeCancellationEnabled?: boolean } | null;
      pets?: { allowed?: boolean } | null;
      ageLimit?: { ageRestriction?: boolean; from?: number; to?: number } | null;
      curfew?: { enabled?: boolean; from?: string; until?: string } | null;
      children?: { allowChildren?: boolean } | null;
    };
    taxes?: { type?: string; amount?: number; taxLabel?: string; included?: boolean }[] | null;
    facilities: { category: string; codes: string[] }[];
    images: string[];
  };
};

/** Bay Area towns Hostelworld lists properties in → county. */
const COUNTY: Record<string, string> = {
  "San Francisco": "San Francisco County",
  Montara: "San Mateo County",
  Pescadero: "San Mateo County",
  "Half Moon Bay": "San Mateo County",
  "Santa Cruz": "Santa Cruz County",
  Oakland: "Alameda County",
  Berkeley: "Alameda County",
  "San Jose": "Santa Clara County",
  Sausalito: "Marin County",
};

/** Guest-facing labels for Hostelworld facility codes (others are kept in attributes only). */
const FACILITY: Record<string, string> = {
  BREAKFASTINCLUDED: "Free breakfast",
  FREEWIFI: "Free Wi-Fi",
  FREECITYTOUR: "Free city tour",
  FREECITYMAPS: "Free city maps",
  FREESECURITYLOCKERS: "Free lockers",
  LOCKERS: "Lockers",
  FREELUGGAGESTORAGE: "Free luggage storage",
  LUGGAGESTORAGE: "Luggage storage",
  PAIDLUGGAGESTORAGE: "Luggage storage (paid)",
  FREEPARKING: "Free parking",
  PAIDPARKING: "Paid parking",
  PARKING: "Parking",
  KITCHEN: "Kitchen",
  FRIDGEFREEZER: "Fridge/freezer",
  MICROWAVE: "Microwave",
  LINENINCLUDED: "Linen included",
  TOWELSINCLUDED: "Towels included",
  TOWELSNOTINCLUDED: "Towels not included",
  TOWELSFORHIRE: "Towels for hire",
  LAUNDRYFACILITIES: "Laundry",
  WASHINGMACHINE: "Washing machine",
  DRYER: "Dryer",
  "24HOURRECEPTION": "24-hour reception",
  "24HOURSECURITY": "24-hour security",
  KEYCARDACCESS: "Key card access",
  AIRCONDITIONING: "Air conditioning",
  ELEVATOR: "Elevator",
  COMMONROOM: "Common room",
  LOUNGEROOM: "Lounge",
  GAMESROOM: "Games room",
  POOLTABLE: "Pool table",
  BAR: "Bar",
  CAF: "Cafe",
  RESTAURANT: "Restaurant",
  MEALSAVAILABLE: "Meals available",
  COWORKINGSPACE: "Coworking space",
  HOTSHOWERS: "Hot showers",
  HOTTUB: "Hot tub",
  SAUNA: "Sauna",
  GARDEN: "Garden",
  OUTDOORTERRACE: "Outdoor terrace",
  BBQ: "BBQ",
  BICYCLEPARKING: "Bicycle parking",
  BICYCLEHIRE: "Bike rental",
  TOURSTRAVELDESK: "Tours/travel desk",
  READINGLIGHT: "Reading light",
  CHARGINGPLUGS: "Charging plugs",
  WHEELCHAIRACCESSIBLE: "Wheelchair accessible",
  MINISUPERMARKET: "Mini market",
  TEACOFFEEMAKINGFACILITIES: "Tea & coffee",
};

const hour = (h?: number | null) => (h == null ? null : `${String(h % 24).padStart(2, "0")}:00`);

/** "Maximum stay is 14 nights" style limits, when the house rules state one. */
function maxStay(notes?: string | null) {
  const m = notes?.match(/max(?:imum)?\.?\s+(?:length\s+of\s+)?stay\s+(?:is\s+|of\s+)?(\d{1,3})\s*(night|day|week)/i);
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase() === "week" ? 7 : 1);
}

function fullAddress(d: HostelworldRaw["detail"], p: HostelworldRaw["property"]) {
  const line = [d.address1, d.address2].filter(Boolean).join(", ") || p.address || null;
  if (!line) return null;
  if (/\b\d{5}\b/.test(line)) return line; // already includes city/state/ZIP
  const zip = d.postalCode && /\d{5}/.test(d.postalCode) ? d.postalCode.match(/\d{5}(-\d{4})?/)![0] : null;
  const city = p.city && !line.toLowerCase().includes(p.city.toLowerCase()) ? p.city : null;
  return [line, city, ["CA", zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export const hostelworld: SourceAdapter = {
  sourceId: "hostelworld",

  normalize(input) {
    const r = input as HostelworldRaw;
    const p = r?.property;
    const d = r?.detail;
    if (!p?.id || !p.name || !d || !(r.priceFrom?.value > 0)) return null;
    if (r.priceFrom.currency && r.priceFrom.currency !== "USD") return null;

    const hr = d.houseRules ?? {};
    const codes = [...new Set(d.facilities.flatMap((f) => f.codes))];
    const lat = d.latitude ?? p.latitude ?? null;
    const lng = d.longitude ?? p.longitude ?? null;
    const isDorm = r.category === "dorm";
    const notes = hr.notes?.replace(/\r/g, "").trim() || null;
    const address = fullAddress(d, p);
    const checkIn = hr.checkin?.from != null ? `${hour(hr.checkin.from)}–${hour(hr.checkin.until) ?? "late"}` : null;
    const age = hr.ageLimit?.ageRestriction ? { min: hr.ageLimit.from ?? null, max: hr.ageLimit.to ?? null } : null;
    const taxesExcluded = (d.taxes ?? []).filter((t) => t.included === false);
    const weekends = r.weekends ?? [];
    const openWeekends = weekends.filter((w) => w.available);

    const listing: NormalizedListing & { address: string | null } = {
      externalId: `${p.id}:${r.category}`,
      externalUrl: r.url,
      type: isDorm ? "shared_room" : "private_room",
      title: `${p.name}: ${isDorm ? "bed in a dorm" : "private room"}`,
      description: d.description?.replace(/\r/g, "").trim() || p.intro || null,
      guestExpectations: null,
      houseRules:
        [
          checkIn ? `Check-in ${checkIn}` : null,
          hr.latestCheckout ? `Check-out by ${hr.latestCheckout}` : null,
          hr.curfew?.enabled ? `Curfew${hr.curfew.from ? ` from ${hr.curfew.from}` : ""}` : "No curfew",
          age ? `Age limit: ${[age.min && `${age.min}+`, age.max && `up to ${age.max}`].filter(Boolean).join(", ")}` : null,
          hr.pets?.allowed === false ? "No pets" : null,
          notes,
        ]
          .filter(Boolean)
          .join("\n") || null,
      neighborhood: null,
      city: p.city ?? null,
      subregion: (p.city && COUNTY[p.city]) ?? null,
      region: d.region ?? "California",
      countryCode: "US",
      lat,
      lng,
      locationPrecision: lat != null && lng != null ? "exact" : null,
      address,
      maxGuests: d.maxGuestsPerBooking ?? null,
      minNights: null,
      maxNights: maxStay(notes),
      priceModel: "paid",
      priceAmountCents: Math.round(r.priceFrom.value * 100),
      pricePeriod: "night",
      currency: "USD",
      amenities: codes.map((c) => FACILITY[c]).filter(Boolean),
      languages: [],
      rating: p.avgRating ? Math.round((p.avgRating / 2) * 10) / 10 : null, // 0 = no reviews yet
      attributes: {
        priceIsFrom: true,
        priceSeenAt: r.seenAt,
        priceSource: r.priceFromSource ?? "listed",
        listedPriceFrom: r.listedPriceFrom?.value ?? (r.priceFromSource ? null : r.priceFrom.value),
        weekendPrices: weekends.length
          ? weekends.map((w) => ({
              checkIn: w.checkIn,
              checkOut: w.checkOut,
              available: w.available,
              lowestPerNight: w.lowestPricePerNight?.value ?? null,
              averagePerNight: w.averagePricePerNight?.value ?? null,
            }))
          : null,
        priceExcludesTaxes: taxesExcluded.length > 0 || /not include tax/i.test(notes ?? ""),
        taxes: d.taxes ?? [],
        roomCategory: r.category,
        propertyType: (d.type ?? p.type ?? "").toLowerCase() || null,
        hostelworldId: p.id,
        address,
        postalCode: d.postalCode ?? null,
        otherCategoryFrom: isDorm ? (p.minPrivatePrice?.value || null) : (p.minDormPrice?.value || null),
        freeBreakfast: codes.includes("BREAKFASTINCLUDED"),
        lockers: codes.includes("LOCKERS") || codes.includes("FREESECURITYLOCKERS"),
        kitchen: codes.includes("KITCHEN"),
        checkIn,
        checkOut: hr.latestCheckout ?? null,
        curfew: hr.curfew?.enabled ?? null,
        ageRestriction: age,
        childrenAllowed: hr.children?.allowChildren ?? null,
        petsAllowed: hr.pets?.allowed ?? null,
        localResidentsRestricted: /outside (of )?the (bay area|city)|not (host|accept)[^.]*(living in|resident)|local residents/i.test(
          notes ?? "",
        ),
        freeCancellationDays: hr.cancellationPolicy?.freeCancellationEnabled ? (hr.cancellationPolicy.canxDays ?? null) : null,
        cityCenterDistanceKm: p.cityCenterDistance ?? null,
        reviewCount: d.reviewCount ?? p.numberReviews ?? null,
        ratingOutOf10: p.avgRating || null,
        ratingBreakdown: p.averageRatings ?? null,
        badges: p.badges ?? [],
        facilities: codes,
        hasAvailability: p.hasAvailability ?? null,
      },
      host: {
        externalId: String(p.id),
        displayName: p.name,
        profileUrl: r.url,
        referenceCount: d.reviewCount ?? p.numberReviews ?? null,
        rating: p.avgRating || null,
      },
      photos: (d.images.length ? d.images : (p.images ?? [])).slice(0, 15).map((url) => ({ sourceUrl: url })),
      // Only the weekends the date pass found bookable; other dates are simply unknown.
      availability: openWeekends.map((w) => ({
        externalId: `${p.id}:${r.category}:${w.checkIn}`,
        startDate: w.checkIn,
        endDate: w.checkOut,
        attributes: {
          kind: "weekend",
          nights: w.nights,
          guests: w.guests,
          currency: w.lowestPricePerNight?.currency ?? "USD",
          lowestPricePerNight: w.lowestPricePerNight?.value ?? null,
          averagePricePerNight: w.averagePricePerNight?.value ?? null,
          rooms: w.rooms.map((rm) => ({
            name: rm.name,
            capacity: rm.capacity,
            ensuite: rm.ensuite,
            bedsAvailable: rm.bedsAvailable,
            roomsAvailable: rm.roomsAvailable,
            averagePricePerNight: rm.averagePricePerNight?.value ?? null,
            totalPrice: rm.totalPrice?.value ?? null,
          })),
          checkedAt: w.checkedAt,
        },
      })),
      raw: r,
    };
    return listing;
  },
};

export default hostelworld;
