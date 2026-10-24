import type { NormalizedListing, SourceAdapter } from "./types";

/** What scripts/scrapers/nomador.browser.js extracts per house sit. */
type Block = { heading: string | null; text: string };
type NomadorRaw = {
  id: string; // short id in /house-sitting/<id>
  stayId?: string | null;
  url: string;
  title?: string | null; // city
  dates?: string | null; // "From the 13 to the 21 Nov 26"
  lat?: number | null;
  lng?: number | null;
  picture?: string | null;
  location?: string | null; // "California, United States"
  flexibility?: string | null;
  pets?: string | null;
  detail?: {
    title?: string;
    location?: string;
    published?: string | null;
    lat?: number | null;
    lng?: number | null;
    photos?: { url: string; width?: number | null; height?: number | null; caption?: string | null }[];
    sections?: Record<string, Block[]>;
    host?: { id: string | null; name: string | null; notes?: string[] } | null;
    stay?: {
      from?: string;
      to?: string;
      caption?: string;
      requests?: string;
      action?: string;
      open?: boolean;
    } | null;
  };
};

const BASE = "https://www.nomador.com";
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** "20 oct 26" → 2026-10-20 */
function parseStayDate(s?: string) {
  const m = /^(\d{1,2}) ([a-z]{3})[a-z]* (\d{2,4})$/i.exec(s?.trim() ?? "");
  const mo = m && MONTHS[m[2].toLowerCase()];
  return m && mo ? iso(year(m[3]), mo, Number(m[1])) : null;
}

/** "From the 13 to the 21 Nov 26" / "From the 22 Dec to the 18 Jan 27" → [start, end] */
function parseCardDates(s?: string | null): [string, string] | null {
  const m = /From the (\d{1,2})(?: ([A-Za-z]{3}))?(?: (\d{2,4}))? to the (\d{1,2}) ([A-Za-z]{3}) (\d{2,4})/.exec(s ?? "");
  if (!m) return null;
  const endY = year(m[6]);
  const endM = MONTHS[m[5].toLowerCase()];
  const startM = m[2] ? MONTHS[m[2].toLowerCase()] : endM;
  if (!endM || !startM) return null;
  // Start year is omitted; it is the end year unless the range wraps the new year.
  const startY = m[3] ? year(m[3]) : startM > endM ? endY - 1 : endY;
  return [iso(startY, startM, Number(m[1])), iso(endY, endM, Number(m[4]))];
}

function lines(text?: string | null) {
  return (text ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

const PET_RE = /^(\d+)\s+([A-Za-z ]+)$/;

export const nomador: SourceAdapter = {
  sourceId: "nomador",

  normalize(input) {
    const r = input as NomadorRaw;
    const d = r?.detail;
    if (!r?.id || !d) return null;
    // Closed offers ("Offer ended") are not bookable any more.
    if (d.stay?.open === false || /offer ended/i.test(r.flexibility ?? "")) return null;
    // Detail page didn't render (removed/redirected stay).
    if (!d.title && !d.stay) return null;

    const range =
      parseStayDate(d.stay?.from) && parseStayDate(d.stay?.to)
        ? ([parseStayDate(d.stay?.from), parseStayDate(d.stay?.to)] as [string, string])
        : parseCardDates(r.dates);
    const today = new Date().toISOString().slice(0, 10);
    if (range && range[1] < today) return null;

    const need = d.sections?.need ?? [];
    const housing = d.sections?.housing ?? [];
    const byHeading = (blocks: Block[], h: string) => blocks.find((b) => b.heading?.toLowerCase() === h.toLowerCase());

    // First "need" heading is the needs summary ("Many plants | 1 Dog"), its text the pet description.
    const needs = need[0] && need[0].heading !== "Additional information about these dates" ? need[0] : null;
    const needItems = (needs?.heading ?? r.pets ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const pets = needItems
      .map((s) => PET_RE.exec(s))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ count: Number(m[1]), animal: m[2].trim().toLowerCase().replace(/s$/, "") }));
    const datesInfo = byHeading(need, "Additional information about these dates")?.text || null;

    const houseDescription = housing.find((b) => b.heading === null)?.text || null;
    const tagsBlock = housing.find((b) => b.heading?.includes("|"));
    const houseTags = (tagsBlock?.heading ?? "")
      .split(/\s*\|\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const comfort = lines(byHeading(housing, "Comfort and Luxury")?.text);
    const tourism = byHeading(housing, "Tourism and Leisure")?.text || null;

    const [region, country] = (d.location || r.location || "").split(",").map((s) => s.trim());
    const city = d.title || r.title || null;
    const lat = d.lat ?? r.lat ?? null;
    const lng = d.lng ?? r.lng ?? null;
    const petLabel = needItems.filter((s) => PET_RE.test(s)).join(", ");
    const timesUsed = d.host?.notes?.join(" ").match(/used Nomador (\d+) times/)?.[1];

    const photos = (d.photos ?? []).map((p) => ({
      sourceUrl: p.url,
      width: p.width ?? null,
      height: p.height ?? null,
      caption: null,
    }));
    if (!photos.length && r.picture) photos.push({ sourceUrl: r.picture, width: null, height: null, caption: null });

    const listing: NormalizedListing = {
      externalId: r.id,
      externalUrl: r.url || `${BASE}/house-sitting/${r.id}`,
      type: "house_sit",
      title: `House sit in ${city ?? "the US"}${petLabel ? ` (${petLabel.toLowerCase()})` : ""}`,
      description: houseDescription,
      guestExpectations: [needs?.text, datesInfo ? `About the dates: ${datesInfo}` : null].filter(Boolean).join("\n\n") || null,
      houseRules: null,
      neighborhood: null,
      city,
      subregion: null,
      region: region || null,
      countryCode: country === "United States" ? "US" : null,
      // Nomador geocodes each stay to its city centroid.
      lat,
      lng,
      locationPrecision: "city",
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "exchange",
      priceAmountCents: null,
      currency: null,
      amenities: comfort,
      languages: [],
      rating: null,
      attributes: {
        pets,
        needs: needItems,
        homeType: houseTags[0] ?? null,
        homeTags: houseTags,
        localArea: tourism,
        datesFlexible: /flexible/i.test(d.stay?.caption ?? r.flexibility ?? ""),
        requests: d.stay?.requests ?? null,
        publishedAt: d.published ?? null,
        hostStaysOnNomador: timesUsed ? Number(timesUsed) : null,
        hostNotes: d.host?.notes ?? [],
      },
      host: d.host?.id
        ? {
            externalId: d.host.id,
            displayName: d.host.name ?? null,
            profileUrl: `${BASE}/profile/${d.host.id}`,
            referenceCount: timesUsed ? Number(timesUsed) : null,
          }
        : undefined,
      photos,
      availability: range
        ? [
            {
              externalId: r.stayId ?? r.id,
              startDate: range[0],
              endDate: range[1],
              attributes: {
                flexible: /flexible/i.test(d.stay?.caption ?? r.flexibility ?? ""),
                requests: d.stay?.requests ?? null,
              },
            },
          ]
        : [],
      raw: r,
    };
    return listing;
  },
};

export default nomador;
