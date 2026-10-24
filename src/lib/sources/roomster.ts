import type { NormalizedListing, SourceAdapter } from "./types";

// Shape written by scripts/scrapers/roomster.node.ts (already stripped of personal data).
type RoomsterItem = {
  id: number;
  listingTypeId?: number;
  title?: string | null;
  description?: string | null;
  neighborhood?: string | null;
  location?: { city?: string | null; region?: string | null; country?: string | null; postalCode?: string | null };
  lat?: number | null;
  lng?: number | null;
  calendar?: { dateIn?: string | null; dateOut?: string | null };
  rates?: { currency?: string | null; monthlyRate?: number | null };
  detailsRoom?: {
    isFurnished?: boolean | null;
    utilitiesCost?: number | null;
    moveInFee?: number | null;
    parkingRent?: number | null;
    peopleInHousehold?: number | null;
    studentsOnly?: boolean | null;
    householdAge?: string | null;
    agePreference?: string | null;
  };
  images?: { id: number; path: string }[];
  refreshed?: string | null;
  isNew?: boolean;
  user?: {
    id: number;
    firstName?: string | null;
    avatar?: string | null;
    registerDate?: string | null;
    isVerified?: boolean | null;
    verifiedEmail?: boolean | null;
    verifiedPhone?: boolean | null;
  } | null;
  amenityLabels?: string[];
  characteristics?: Record<string, Record<string, string>>;
  searchSlugs?: string[];
};

const BASE = "https://roomster.com";

const SHARED = /\b(shared (bed)?room|share (a|the|my) (bed)?room|bunk ?beds?|shared space in (a |the )?(bed)?room)\b/i;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const yesNo = (s?: string) => (s === "Yes" ? true : s === "No" ? false : null);
const num = (s?: string) => (s && /\d/.test(s) ? Number(s.replace(/[^\d.]/g, "")) : null);
const capitalize = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null);

export const roomster: SourceAdapter = {
  sourceId: "roomster",

  normalize(input) {
    const l = input as RoomsterItem;
    if (!l?.id || l.listingTypeId !== 2) return null;

    const room = l.detailsRoom ?? {};
    const ch = l.characteristics ?? {};
    const residence = ch.Residence ?? {};
    const household = ch.Household ?? {};
    const lifestyle = ch.Lifestyle ?? {};
    const pref = ch["Roommate preference"] ?? {};

    const rate = l.rates?.monthlyRate ?? null;
    // Placeholder rents ($1, $10) are "contact me", not prices.
    const priceAmountCents = rate != null && rate >= 100 ? Math.round(rate * 100) : null;

    // Availability: from the move-in date (or today, if that's past), open-ended → 12 months.
    const today = ymd(new Date());
    const moveIn = l.calendar?.dateIn?.slice(0, 10) ?? null;
    const start = moveIn && moveIn > today ? moveIn : today;
    const dateOut = l.calendar?.dateOut?.slice(0, 10) ?? null;
    const end = dateOut && dateOut > start ? dateOut : (() => {
      const d = new Date(`${start}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 12);
      return ymd(d);
    })();

    const text = `${l.title ?? ""}\n${l.description ?? ""}`;
    const title = l.title?.trim() || `Room for rent in ${l.location?.city ?? "the Bay Area"}`;

    const listing: NormalizedListing = {
      externalId: String(l.id),
      externalUrl: `${BASE}/listings/${l.id}`,
      type: SHARED.test(text) ? "shared_room" : "private_room",
      title: title === "New Listing" ? `Room for rent in ${l.location?.city ?? "the Bay Area"}` : title,
      description: l.description?.trim() || null,
      guestExpectations: null,
      houseRules: null,
      neighborhood: l.neighborhood ?? null,
      city: l.location?.city ?? null,
      subregion: null,
      region: l.location?.region ?? null,
      countryCode: l.location?.country?.toUpperCase() ?? null,
      // Scraper rounds to 2 decimals (~1 km); Roomster's pin is the street address.
      lat: l.lat ?? null,
      lng: l.lng ?? null,
      locationPrecision: "approximate",
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents,
      currency: priceAmountCents != null ? (l.rates?.currency ?? "USD") : null,
      pricePeriod: priceAmountCents != null ? "month" : null,
      amenities: (l.amenityLabels ?? []).map(slug),
      languages: [],
      rating: null,
      attributes: {
        listedMonthlyRate: rate,
        furnished: room.isFurnished ?? yesNo(residence.Furnished),
        utilitiesCostMonthly: room.utilitiesCost ?? num(residence["Utilities Cost"]),
        utilitiesIncluded: room.utilitiesCost === 0 ? true : null,
        moveInFee: room.moveInFee ?? num(residence["Move-in Fee"]),
        parkingRent: room.parkingRent ?? num(residence["Parking Rent"]),
        buildingType: residence["Building Type"] ?? null,
        leaseTerm: null,
        household: {
          people: room.peopleInHousehold ?? num(household["People In Household"]),
          ageRange: household["Household Age"] ?? room.householdAge ?? null,
          sex: household["Household Sex"] ?? null,
          cleanliness: lifestyle["My Cleanliness"] ?? null,
          overnightGuests: lifestyle["Overnight Guests"] ?? null,
          partyHabits: lifestyle["Party Habits"] ?? null,
          schedule: lifestyle["I Get Up/Go To Bed"] ?? null,
          food: lifestyle["Food Preference"] ?? null,
          smoker: yesNo(lifestyle.Smoker),
          pets: lifestyle["Pets Owner"] ?? null,
          workSchedule: lifestyle["Work Schedule"] ?? null,
          occupation: lifestyle.Occupation ?? null,
        },
        roommatePreference: {
          ageRange: pref.Age ?? room.agePreference ?? null,
          smoking: pref.Smoking ?? null,
          pets: pref.Pets ?? null,
          studentsOnly: room.studentsOnly ?? yesNo(pref["Students Only"]),
        },
        moveInDate: moveIn,
        postedAt: l.refreshed ?? null,
        postalCode: l.location?.postalCode ?? null,
        hostVerified: l.user?.isVerified ?? null,
        searchPages: l.searchSlugs ?? [],
      },
      host: l.user
        ? {
            externalId: String(l.user.id),
            displayName: capitalize(l.user.firstName),
            profileUrl: `${BASE}/profile/${l.user.id}`,
            avatarUrl: l.user.avatar ?? null,
            memberSince: l.user.registerDate ? new Date(l.user.registerDate) : null,
          }
        : undefined,
      photos: (l.images ?? []).map((p) => ({ sourceUrl: p.path })),
      availability: [
        {
          externalId: null,
          startDate: start,
          endDate: end,
          attributes: dateOut ? { moveInDate: moveIn } : { openEnded: true, moveInDate: moveIn },
        },
      ],
      raw: l,
    };
    return listing;
  },
};

export default roomster;
