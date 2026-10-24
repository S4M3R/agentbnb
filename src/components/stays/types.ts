import type { AgentUIMessage } from "@/lib/agent/tools";

type Part = AgentUIMessage["parts"][number];

export type SearchOutput = Extract<Part, { type: "tool-searchStays"; state: "output-available" }>["output"];
export type StayResult = SearchOutput["results"][number];

type ListingOutput = Extract<Part, { type: "tool-getListing"; state: "output-available" }>["output"];
export type StayDetails = Exclude<ListingOutput, { error: unknown }>;

type Person = { name: string; photo?: string | null };

/** What a stay card shows, for marketplace results and AgentBnB hosts alike. */
export type StayCardData = {
  id: string;
  title: string;
  /** Neighborhood and city, e.g. "Alfama, Lisbon". */
  place: string;
  photo?: string | null;
  /** Shown as a face on the photo. */
  host?: Person;
  /** One line under the title: who the host is, or dates and source. */
  detail?: string;
  /** Price in nights, for AgentBnB hosts. */
  nights?: number;
  rating?: number | null;
  /** Corner label on the photo, e.g. "Best match" or "House sit". */
  badge?: string;
  /** Why this stay fits the guest, e.g. "Founder", "Snowboards". */
  reasons?: string[];
  /** Price line under the card, e.g. { amount: "$45", period: "night" } or { amount: "Free" }. */
  price?: { amount: string; period?: string };
  /** The marketplace: a source id ("workaway") or URL. Its favicon shows before the detail line. */
  site?: string | null;
  /** Opens the listing on its own site, in a new tab, instead of calling `onOpen` alone. */
  href?: string | null;
};

export type FitReason = { icon: "work" | "sport" | "dates" | "check"; title: string; detail?: string };

/** What the listing panel shows. */
export type StayPanelData = {
  title: string;
  /** e.g. "Private room in Alfama, Lisbon · 1 guest". */
  subtitle?: string;
  photos: string[];
  host?: Person & { detail?: string };
  fit?: FitReason[];
  /** Open dates, formatted for display. */
  dates?: string[];
  rules?: string[];
  description?: string | null;
  /** The marketplace: a source id or URL. Its favicon shows before the subtitle. */
  site?: string | null;
};
