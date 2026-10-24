import type { NormalizedListing, SourceAdapter } from "./types";

/**
 * What scripts/scrapers/apartmentlist.node.ts writes per building: a sample of the cheapest
 * San Francisco studios. Apartment List lists whole apartments only, so each building becomes one
 * entire_place listing priced at its cheapest available studio.
 */
type Photo = { id: string; type?: string; caption?: string | null };
type UnitDetail = {
  id: number;
  name?: string;
  price?: number;
  sqft?: number | null;
  availability?: string;
  available_on?: string | null;
  base_price?: number | null;
  total_price?: number | null;
  required_fees?: number | null;
  lease_length?: number | null;
  available_now?: boolean;
};
type Floorplan = {
  id: number;
  name?: string;
  bed: number;
  bath?: number;
  sqft?: number | null;
  sqft_max?: number | null;
  price?: number;
  photos?: Photo[];
  units?: UnitDetail[];
};
type Amenity = { display_name: string; group?: string };
type Building = {
  rental_id: string;
  slug?: string;
  display_name?: string;
  street_address?: string;
  neighborhood?: string | null;
  meta_neighborhood?: string | null;
  zip?: string;
  city?: string;
  county?: string | null;
  formatted_address?: string;
  lat?: number;
  lon?: number;
  description?: unknown;
  short_highlight?: unknown;
  long_highlight?: unknown;
  rental_type?: string;
  all_photos?: Photo[];
  top_amenities?: Amenity[];
  unit_amenities?: Amenity[];
  community_amenities?: Amenity[];
  parking?: { category?: string; space_fee?: number | null; comment?: string | null }[];
  available_units?: Floorplan[];
  pet_policies?: unknown;
  lease_terms_text?: unknown;
  deposit_fee_text?: unknown;
  application_fee_text?: unknown;
  additional_fees_text?: unknown;
  move_in_fees_text?: unknown;
  utilities_included_text?: unknown;
  specials?: unknown[];
  year_built?: number | null;
  year_remodeled?: number | null;
  total_units_count?: number | null;
  pmc_display_name?: string | null;
  source_name?: string | null;
  income_requirement_text?: unknown;
  smoking_in_unit_allowed_text?: unknown;
};
type ApartmentListRaw = {
  url: string;
  scrapedAt?: string;
  searchStudioPrice?: number | null;
  building: Building;
  units?: { unit_id: string; bed_count: number; date_available?: string | null; price: number; sq_ft?: number | null }[];
  byBedCount?: Record<string, { minPrice: number; maxPrice: number }> | null;
  soonestAvailable?: string | null;
};

/** RSC payload strings: "$$58" is an escaped "$58"; "$7a" / "$76:props:…" are unresolved references. */
function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (/^\$(?!\$)[0-9a-zA-Z]*(:|$)/.test(v)) return null;
  const s = v.replace(/^\$\$/, "$").replace(/\$\$/g, "$").trim();
  return s ? redact(s) : null;
}
const redact = (s: string) =>
  s
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, "[phone removed]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email removed]");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const round5 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 1e5) / 1e5);
const money = (s: string | null) => {
  if (!s) return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Deep-clean RSC escapes and drop unresolved references from the raw record. */
function cleanDeep(v: unknown): unknown {
  if (typeof v === "string") return text(v);
  if (Array.isArray(v)) return v.map(cleanDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x)]));
  return v;
}

export const apartmentlist: SourceAdapter = {
  sourceId: "apartmentlist",

  normalize(input) {
    const r = input as ApartmentListRaw;
    const b = r?.building;
    if (!b?.rental_id || !r.url) return null;

    const now = r.scrapedAt ? new Date(r.scrapedAt) : new Date();
    const today = iso(now);

    // Every priced studio unit (bed 0) across the building's floorplans.
    const studioUnits = (b.available_units ?? [])
      .filter((fp) => fp.bed === 0)
      .flatMap((fp) =>
        (fp.units?.length ? fp.units : [{ id: fp.id, price: fp.price, sqft: fp.sqft, available_on: null } as UnitDetail]).map((u) => ({
          floorplan: fp.name ?? null,
          floorplanPhotos: fp.photos ?? [],
          bath: fp.bath ?? null,
          unit: u.name ?? null,
          price: u.price && u.price > 0 ? u.price : fp.price && fp.price > 0 ? fp.price : null,
          totalPrice: u.total_price ?? null,
          requiredFees: u.required_fees ?? null,
          sqft: u.sqft ?? fp.sqft ?? null,
          availableOn: u.available_on ?? null,
          leaseMonths: u.lease_length ?? null,
        })),
      )
      .filter((u) => u.price != null);
    // Fallback: the page's unit summary, then the search card's studio price.
    const summary = (r.units ?? []).filter((u) => u.bed_count === 0 && u.price > 0);
    const cheapest = studioUnits.sort((a, b) => a.price! - b.price!)[0];
    const cheapestSummary = summary.sort((a, b) => a.price - b.price)[0];
    const monthly = cheapest?.price ?? cheapestSummary?.price ?? r.byBedCount?.["0"]?.minPrice ?? r.searchStudioPrice ?? null;
    if (!monthly) return null;

    const availableOn = cheapest?.availableOn ?? cheapestSummary?.date_available ?? r.soonestAvailable ?? null;
    const start = availableOn && availableOn > today ? availableOn : today;
    const end = iso(new Date(Date.parse(start) + 365 * 864e5));
    const studioDates = [...studioUnits.map((u) => u.availableOn), ...summary.map((u) => u.date_available)].filter(
      (d): d is string => Boolean(d),
    );

    const amenities = [
      ...new Set([...(b.top_amenities ?? []), ...(b.unit_amenities ?? []), ...(b.community_amenities ?? [])].map((a) => a.display_name)),
    ];
    const utilities = text(b.utilities_included_text);
    const leaseTerms = text(b.lease_terms_text);
    const leaseMonths = cheapest?.leaseMonths ?? (leaseTerms?.match(/(\d+)\s*month/i) ? Number(leaseTerms.match(/(\d+)\s*month/i)![1]) : null);
    const description = text(b.description) ?? text(b.long_highlight) ?? text(b.short_highlight);
    const name = text(b.display_name) ?? text(b.street_address) ?? "Studio apartment";
    const hood = text(b.neighborhood) ?? text(b.meta_neighborhood);
    const photos = [...(cheapest?.floorplanPhotos ?? []), ...(b.all_photos ?? [])]
      .filter((p, i, all) => p?.id && all.findIndex((q) => q.id === p.id) === i)
      .slice(0, 25)
      .map((p) => ({ sourceUrl: `https://cdn.apartmentlist.com/image/upload/f_auto,q_auto,t_web-base/${p.id}.jpg`, caption: text(p.caption) }));

    const listing: NormalizedListing = {
      externalId: b.rental_id,
      externalUrl: r.url,
      type: "entire_place",
      title: `Studio at ${name}${hood ? `, ${hood}` : ""}`,
      description,
      guestExpectations: null,
      houseRules: text(b.smoking_in_unit_allowed_text),
      neighborhood: hood,
      city: text(b.city) ?? "San Francisco",
      subregion: "San Francisco County",
      region: "California",
      countryCode: "US",
      // Public apartment-building address.
      lat: round5(b.lat),
      lng: round5(b.lon),
      locationPrecision: b.lat != null ? "exact" : null,
      maxGuests: 2,
      minNights: leaseMonths ? leaseMonths * 30 : null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents: Math.round(monthly * 100),
      pricePeriod: "month",
      currency: "USD",
      amenities,
      languages: [],
      rating: null,
      attributes: {
        unitType: "studio",
        rentalType: b.rental_type ?? null,
        buildingName: name,
        address: text(b.formatted_address),
        zip: b.zip ?? null,
        studioFloorplan: cheapest?.floorplan ?? null,
        studioUnit: cheapest?.unit ?? cheapestSummary?.unit_id ?? null,
        studioSqft: cheapest?.sqft ?? cheapestSummary?.sq_ft ?? null,
        studioPriceRange: r.byBedCount?.["0"] ?? null,
        studioUnitsAvailable: Math.max(studioUnits.length, summary.length),
        totalMonthlyWithFees: cheapest?.totalPrice ?? null,
        requiredMonthlyFees: cheapest?.requiredFees ?? null,
        pricesByBedrooms: r.byBedCount ?? null,
        furnished: amenities.some((a) => /^furnished/i.test(a)) || null,
        utilitiesIncluded: utilities,
        deposit: money(text(b.deposit_fee_text)),
        depositText: text(b.deposit_fee_text),
        applicationFee: text(b.application_fee_text),
        additionalFees: text(b.additional_fees_text),
        moveInFees: text(b.move_in_fees_text),
        leaseTerms,
        leaseMonths,
        specials: cleanDeep(b.specials ?? []),
        petPolicy: cleanDeep(b.pet_policies ?? null),
        parking: (b.parking ?? []).filter((p) => p.category && p.category !== "none").map((p) => ({ category: p.category, fee: p.space_fee ?? null, note: text(p.comment) })),
        incomeRequirement: text(b.income_requirement_text),
        yearBuilt: b.year_built ?? null,
        yearRemodeled: b.year_remodeled ?? null,
        buildingUnits: b.total_units_count ?? null,
        manager: b.pmc_display_name ?? null,
        feed: b.source_name ?? null,
      },
      host: undefined,
      photos,
      availability: [
        {
          externalId: null,
          startDate: start,
          endDate: end,
          attributes: {
            openEnded: true,
            availableNow: start === today,
            availableOn,
            studioMoveInDates: [...new Set(studioDates)].sort(),
          },
        },
      ],
      raw: cleanDeep(r),
    };
    return listing;
  },
};

export default apartmentlist;
