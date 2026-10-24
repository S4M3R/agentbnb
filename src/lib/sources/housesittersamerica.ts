import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/housesittersamerica.browser.js extracts per job. */
type HsaRaw = {
  id: string;
  url: string;
  cardDates?: string | null; // "5 Nov 2026 - 5 Dec 2026 (approx)"
  duration?: string | null;
  homeType?: string | null;
  pay?: string | null; // "free" | "$30/day"
  tag?: string | null;
  startsSoon?: boolean;
  pets?: { animal: string | null; count: number | null }[];
  ld?: {
    title?: string;
    description?: string;
    datePosted?: string;
    validThrough?: string;
    hiringOrganization?: { name?: string; logo?: string };
    image?: string;
    jobLocation?: {
      address?: { addressLocality?: string; addressRegion?: string; postalCode?: string; addressCountry?: string };
    };
    baseSalary?: { currency?: string; value?: { value?: number; unitText?: string } };
  } | null;
  city?: string;
  area?: string; // "California - San Francisco Bay Area"
  title?: string;
  dates?: string | null; // "13 Nov 2026 - 16 Nov 2026 (3 nights)"
  locationPath?: string | null; // "California - San Francisco Bay Area - San Francisco"
  payment?: string | null;
  areaLove?: string | null;
  houseType?: string | null;
  features?: string | null;
  accessibility?: string | null;
  locale?: string | null;
  nearby?: string | null;
  gardenCare?: string | null;
  guestsWelcome?: string | null;
  petsWelcome?: string | null;
  smoking?: string | null;
  home?: string | null;
  petsDescription?: string | null;
  gardenDescription?: string | null;
  petChips?: string[];
  owner?: string | null;
  memberSince?: string | null; // "Jul 2024"
  replyRating?: number | null; // 0-10
  reviewCount?: number;
  reviewAverage?: number | null; // 0-5
  lat?: number | null;
  lng?: number | null;
  photos?: string[];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "13 Nov 2026" → "2026-11-13". */
function isoDate(s: string) {
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  const month = m && MONTHS[m[2].toLowerCase()];
  if (!m || !month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function parseRange(s?: string | null) {
  // "5 Nov 2026* - 5 Dec 2026* (*Approx) (1 month)": asterisks mark approximate dates.
  const m = s?.replace(/\*/g, "").match(/(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})\s*-\s*(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/);
  if (!m) return null;
  const start = isoDate(m[1]);
  const end = isoDate(m[2]);
  return start && end ? { start, end, approx: /approx/i.test(s ?? "") } : null;
}

function csv(s?: string | null) {
  return (s ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const yesNo = (s?: string | null) => (s == null ? null : /^yes/i.test(s) ? true : /^no/i.test(s) ? false : s);

/** "$30/day", "$30pd" → 3000 cents per day. */
function dailyPayCents(r: HsaRaw) {
  const v = r.ld?.baseSalary?.value;
  if (v?.value && /day/i.test(v.unitText ?? "")) return Math.round(v.value * 100);
  const m = (r.pay ?? r.payment ?? "").match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*day|pd)/i);
  return m ? Math.round(Number(m[1]) * 100) : null;
}

export const houseSittersAmerica: SourceAdapter = {
  sourceId: "housesittersamerica",

  normalize(input) {
    const r = input as HsaRaw;
    const title = (r?.title || r?.tag || r?.ld?.title || "").trim();
    if (!r?.id || !title) return null;

    // "California - San Francisco Bay Area - San Francisco" = state - region - county
    const [state, area, county] = (r.locationPath ?? r.area ?? "").split(" - ").map((s) => s.trim());
    const addr = r.ld?.jobLocation?.address;
    const city = r.city?.trim() || addr?.addressLocality || null;

    const range = parseRange(r.dates) ?? parseRange(r.cardDates);
    const today = new Date().toISOString().slice(0, 10);
    const payCents = dailyPayCents(r);

    const hasPin = r.lat != null && r.lng != null && Number.isFinite(r.lat) && Number.isFinite(r.lng);

    const listing: NormalizedListing = {
      externalId: String(r.id),
      externalUrl: r.url,
      type: "house_sit",
      title,
      description: r.home?.trim() || r.ld?.description?.trim() || null,
      guestExpectations: r.petsDescription?.trim() || null,
      houseRules: null,
      neighborhood: null,
      city,
      subregion: county ? `${county} County` : null,
      region: state || null,
      countryCode: "US",
      // The site says "Location shown is indicative only".
      lat: hasPin ? r.lat! : null,
      lng: hasPin ? r.lng! : null,
      locationPrecision: hasPin ? "approximate" : "city",
      maxGuests: null,
      minNights: null,
      maxNights: null,
      // Some homeowners pay the sitter a daily rate; that's recorded in attributes,
      // the stay itself is still an exchange.
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: csv(r.features),
      languages: [],
      rating: r.reviewAverage ?? null,
      attributes: {
        tagline: r.tag ?? null,
        area: area ?? null,
        postalCode: addr?.postalCode ?? null,
        homeType: r.houseType ?? r.homeType ?? null,
        duration: r.duration ?? null,
        pets: r.petChips?.length ? r.petChips : (r.pets ?? []).map((p) => `${p.animal} (${p.count ?? "?"})`),
        sitterPayPerDayCents: payCents,
        sitterPayCurrency: payCents ? (r.ld?.baseSalary?.currency ?? "USD") : null,
        aboutArea: r.areaLove ?? null,
        accessibility: r.accessibility ?? null,
        locale: csv(r.locale),
        nearby: csv(r.nearby),
        gardenCare: yesNo(r.gardenCare),
        gardenDescription: r.gardenDescription ?? null,
        guestsWelcome: yesNo(r.guestsWelcome),
        petsWelcome: yesNo(r.petsWelcome),
        smokingPermitted: yesNo(r.smoking),
        startsSoon: r.startsSoon ?? false,
        reviewCount: r.reviewCount ?? 0,
        replyRating: r.replyRating ?? null,
        postedAt: r.ld?.datePosted ?? null,
      },
      host: r.owner
        ? {
            // HSA doesn't expose a member id publicly; one job ad per homeowner.
            externalId: `job-${r.id}`,
            displayName: r.owner,
            profileUrl: r.url,
            referenceCount: r.reviewCount ?? null,
            rating: r.reviewAverage ?? null,
            memberSince: r.memberSince ? new Date(`1 ${r.memberSince} UTC`) : null,
          }
        : undefined,
      photos: (r.photos ?? []).map((url) => ({ sourceUrl: url })),
      availability:
        range && range.end >= today
          ? [
              {
                externalId: null,
                startDate: range.start,
                endDate: range.end,
                attributes: { approximate: range.approx },
              },
            ]
          : [],
      raw: r,
    };

    return listing;
  },
};

export default houseSittersAmerica;
