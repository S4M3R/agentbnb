import type { NormalizedListing, SourceAdapter } from "./types";

/**
 * Room/sublet OFFER posts read from public Facebook housing groups through the
 * user's own logged-in session (manually paced). We keep only the post text,
 * the post URL and the poster's profile URL; no other profile data.
 */
type FacebookPostRaw = {
  id: string;
  postUrl: string;
  groupId: string;
  groupName: string;
  authorProfileUrl: string | null;
  text: string;
};

// Neighborhood centroids, used as approximate locations (precision "neighborhood").
const SF_NEIGHBORHOODS: Record<string, [number, number]> = {
  "nob hill": [37.7930, -122.4161],
  "russian hill": [37.8011, -122.4194],
  "glen park": [37.7340, -122.4330],
  "mission bay": [37.7706, -122.3910],
  nopa: [37.7766, -122.4420],
  "mission district": [37.7599, -122.4148],
  soma: [37.7785, -122.4056],
  marina: [37.8037, -122.4368],
  "cow hollow": [37.7978, -122.4359],
  fidi: [37.7946, -122.3999],
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parsePrice(text: string) {
  const m = text.match(/\$\s?(\d{1,2},?\d{3})|(\d{1,2},?\d{3})\s?\$/);
  const raw = m?.[1] ?? m?.[2];
  return raw ? Number(raw.replace(",", "")) * 100 : null;
}

/** "Nov 1", "11/1", "mid December", "end of Nov" → YYYY-MM-DD (next occurrence). */
function parseMoveIn(input: string) {
  const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  // "lease ends February" is an end date, not a move-in date.
  const text = input.replace(new RegExp(`\\bends?\\s+(?:in\\s+)?(?:${MONTH})\\b`, "gi"), "");
  const now = new Date();
  const toIso = (month: number, day: number) => {
    let year = now.getUTCFullYear();
    if (month < now.getUTCMonth()) year++;
    return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  };
  const numeric = text.match(/move[- ]in(?: date)?:?\s*(\d{1,2})\/(\d{1,2})/i);
  if (numeric) return toIso(Number(numeric[1]) - 1, Number(numeric[2]));
  // "May" only counts with a day number ("may extend" is a verb).
  const named = text.match(
    new RegExp(`\\b(mid|end of|early)?\\s*(?:(may)\\s+(\\d{1,2})|(${MONTH.replace("may|", "")})\\.?\\s*(\\d{1,2})?)\\b`, "i"),
  );
  if (!named) return null;
  const monthName = (named[2] ?? named[4]).toLowerCase().slice(0, 3);
  const dayText = named[3] ?? named[5];
  const month = MONTHS.indexOf(monthName);
  const day = dayText ? Number(dayText) : named[1]?.startsWith("mid") ? 15 : named[1]?.startsWith("end") ? 28 : 1;
  return toIso(month, day);
}

export const facebookGroups: SourceAdapter = {
  sourceId: "facebook-groups",

  normalize(input) {
    const p = input as FacebookPostRaw;
    if (!p?.id || !p.text) return null;

    const text = p.text.replace(/\s*…?\s*Ver más$/, "").trim();
    const lower = text.toLowerCase();
    const hood = Object.keys(SF_NEIGHBORHOODS).find((n) => lower.includes(n));
    const [lat, lng] = hood ? SF_NEIGHBORHOODS[hood] : [null, null];
    const entirePlace = /one bedroom|1 ?br\b|studio|attic flat|sublease \|/i.test(text);
    const moveIn = parseMoveIn(text);
    const end = moveIn ? new Date(Date.parse(moveIn) + 365 * 864e5).toISOString().slice(0, 10) : null;

    const listing: NormalizedListing = {
      externalId: p.id,
      externalUrl: p.postUrl,
      type: entirePlace ? "entire_place" : "private_room",
      title: text.split("\n")[0].slice(0, 120),
      description: text,
      guestExpectations: null,
      houseRules: null,
      neighborhood: hood ? hood.replace(/\b\w/g, (c) => c.toUpperCase()) : null,
      city: "San Francisco",
      subregion: "San Francisco County",
      region: "California",
      countryCode: "US",
      lat,
      lng,
      locationPrecision: hood ? "neighborhood" : "city",
      maxGuests: null,
      minNights: null,
      maxNights: null,
      priceModel: "paid",
      priceAmountCents: parsePrice(text),
      pricePeriod: "month",
      currency: "USD",
      amenities: [],
      languages: [],
      rating: null,
      attributes: { group: p.groupName, groupId: p.groupId, truncated: /Ver más$/.test(p.text) },
      host: p.authorProfileUrl
        ? { externalId: p.authorProfileUrl.match(/id=(\d+)/)?.[1] ?? p.authorProfileUrl, profileUrl: p.authorProfileUrl }
        : undefined,
      photos: [],
      availability: moveIn && end ? [{ startDate: moveIn, endDate: end, attributes: { openEnded: true } }] : [],
      raw: p,
    };
    return listing;
  },
};

export default facebookGroups;
