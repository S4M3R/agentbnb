// Props for the host-side components. Adapters (./adapters.ts) build them from the hosting libs.

/** How a status reads: live (green), working (moving), attention (the host's turn), failed, idle, draft. */
export type PublishTone = "live" | "working" | "attention" | "failed" | "idle" | "draft";

export type PublishStatus = { label: string; tone: PublishTone };

/** One network in the publish picker. */
export type PickerRow = {
  /** Network id, also the favicon key. */
  id: string;
  name: string;
  pitch: string;
  reason: string;
  recommended: boolean;
  selected: boolean;
  /** Live or publishing there already: shows its status, can't be picked. */
  locked: boolean;
  status?: PublishStatus;
  /** A line under the reason, e.g. why the last try failed. */
  note?: string;
};

/** A host's listing as its card shows it. */
export type HostListingCardData = {
  id: string;
  title: string;
  /** "Mission, San Francisco". */
  place: string | null;
  /** "Private room". */
  kind: string;
  /** "Free stay while you're home". */
  arrangement: string;
  photo: string | null;
  photoCount: number;
  status: PublishStatus;
  /** Open dates, formatted, e.g. "Oct 30 – Nov 1". */
  dates: string[];
};

/** What a "Where it's listed" row offers. */
export type PlaceAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "button"; label: string; emphasis?: boolean };

/** One site in "Where it's listed": AgentBnB itself or an external network. */
export type ListedPlace = {
  /** Source id ("internal" for AgentBnB), also the favicon key. */
  id: string;
  name: string;
  status: PublishStatus;
  /** A short muted line, e.g. "Guests on AgentBnB can find it". */
  detail?: string;
  action?: PlaceAction;
};
