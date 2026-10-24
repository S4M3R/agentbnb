import type { MapListing } from "@/lib/map-listings";
import { formatRange, TYPE_LABEL } from "./format";
import type { StayCardData } from "./types";

/** The map's category tabs, one per kind of stay, in strip order. */
export const STAY_CATEGORIES = [
  { id: "couch", label: "Couches", one: "Couch" },
  { id: "house_sit", label: "House sits", one: "House sit" },
  { id: "home_swap", label: "Home swaps", one: "Home swap" },
  { id: "work_exchange", label: "Work exchange", one: "Work exchange" },
  { id: "farm_stay", label: "Farm stays", one: "Farm stay" },
  { id: "rental", label: "Rentals", one: "Rental" },
  { id: "hostel", label: "Hostels", one: "Hostel" },
] as const;

export type StayCategory = (typeof STAY_CATEGORIES)[number]["id"];

const CATEGORY_IDS = new Set<string>(STAY_CATEGORIES.map((c) => c.id));
const CATEGORY = Object.fromEntries(STAY_CATEGORIES.map((c) => [c.id, c])) as Record<
  StayCategory,
  (typeof STAY_CATEGORIES)[number]
>;

/**
 * Which tab a listing sits under. Marketplaces are one kind each, so the source decides; our own
 * hosts (and any source of an unknown kind) fall back to the listing's type.
 */
export function categoryOf(l: Pick<MapListing, "sourceKind" | "type" | "priceModel">): StayCategory {
  if (CATEGORY_IDS.has(l.sourceKind)) return l.sourceKind as StayCategory;
  if (l.type === "house_sit" || l.type === "work_exchange" || l.type === "farm_stay") return l.type;
  return l.priceModel === "paid" ? "rental" : "couch";
}

/** The word a pin shows when there's no price: what you'd do there. */
const PIN_WORD: Record<StayCategory, string> = {
  couch: "Couch",
  house_sit: "House sit",
  home_swap: "Swap",
  work_exchange: "Volunteer",
  farm_stay: "Farm stay",
  rental: "Rental",
  hostel: "Hostel",
};

const PERIOD_SHORT = { night: "", week: "/wk", month: "/mo", stay: "/stay" } as const;
const PERIOD_LONG = { night: "night", week: "week", month: "month", stay: "total" } as const;

const formatters = new Map<string, Intl.NumberFormat>();
function money(cents: number, currency: string | null) {
  const code = currency ?? "USD";
  let f = formatters.get(code);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 });
    } catch {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    }
    formatters.set(code, f);
  }
  return f.format(Math.round(cents / 100));
}

/** A map pin's label: "$45", "$2,260/mo", or the kind of stay ("House sit", "Swap") or "Free". */
export function pinLabel(l: MapListing): string {
  if (l.priceCents != null) return money(l.priceCents, l.currency) + (l.pricePeriod ? PERIOD_SHORT[l.pricePeriod] : "");
  if (l.priceModel === "free") return "Free";
  return PIN_WORD[categoryOf(l)];
}

/** What you give for the stay, shown where Airbnb puts the nightly price. */
function priceLine(l: MapListing, category: StayCategory): StayCardData["price"] {
  if (l.priceCents != null) {
    return { amount: money(l.priceCents, l.currency), period: l.pricePeriod ? PERIOD_LONG[l.pricePeriod] : undefined };
  }
  if (l.priceModel === "free") return { amount: "Free" };
  if (l.priceModel === "paid") return { amount: "Paid", period: "· price on the listing" };
  switch (category) {
    case "home_swap":
      return { amount: "Home swap", period: "· your place for theirs" };
    case "house_sit":
      return { amount: "Free", period: l.summary ? `· care for ${l.summary}` : "· for house sitting" };
    case "work_exchange":
    case "farm_stay":
      return { amount: "Free", period: l.summary ? `· ${l.summary}` : "· in exchange for help" };
    default:
      return { amount: "Exchange" };
  }
}

/** "House sit", or the room type for rentals and hostels ("Private room", "Shared room"). */
export function kindLabel(l: MapListing, category = categoryOf(l)) {
  if (category === "rental" || category === "hostel" || category === "couch") {
    return TYPE_LABEL[l.type] ?? CATEGORY[category].one;
  }
  return CATEGORY[category].one;
}

/** A map listing as a stay card: kind as the badge, source and dates underneath, price last. */
export function toMapStayCard(l: MapListing): StayCardData {
  const category = categoryOf(l);
  return {
    id: l.id,
    title: l.title,
    place: l.place ?? "Location on request",
    photo: l.photo,
    badge: kindLabel(l, category),
    detail: [l.sourceName, l.nextAvailable && formatRange(l.nextAvailable.start, l.nextAvailable.end)]
      .filter(Boolean)
      .join(" · "),
    rating: l.rating,
    price: priceLine(l, category),
    site: l.sourceId,
    href: l.url,
  };
}
