import { formatRange, TYPE_LABEL } from "@/components/stays/format";
import type { HostListing } from "@/lib/hosting/listings";
import { ARRANGEMENT_LABEL, type NetworkFit } from "@/lib/hosting/networks";
import type { HostListingCardData, ListedPlace, PickerRow, PublishStatus } from "./types";

// Hosting data → the props-only components in this folder.

/** "/?prompt=…": the chat opens with this line in its composer, for the host to finish and send. */
export const chatWith = (prompt: string) => `/?prompt=${encodeURIComponent(prompt)}`;

/** A network with the listing's publication there, if any (networksForListing). */
export type NetworkWithPublication = NetworkFit & {
  publication: { id: string; status: string; externalUrl?: string | null } | null;
};

/** An external publication's status as a chip; no publication (or a removed one) reads "Not listed". */
export function publicationStatus(status: string | null | undefined): PublishStatus {
  switch (status) {
    case "live":
      return { label: "Live", tone: "live" };
    case "running":
      return { label: "Publishing…", tone: "working" };
    case "queued":
      return { label: "Queued", tone: "working" };
    case "needs_user":
      return { label: "Needs you", tone: "attention" };
    case "failed":
      return { label: "Failed", tone: "failed" };
    default:
      return { label: "Not listed", tone: "idle" };
  }
}

const LISTING_STATUS: Record<HostListing["status"], PublishStatus> = {
  active: { label: "Live on AgentBnB", tone: "live" },
  draft: { label: "Draft", tone: "draft" },
  paused: { label: "Paused", tone: "idle" },
  gone: { label: "Removed", tone: "idle" },
};

export function toHostListingCard(l: HostListing): HostListingCardData {
  return {
    id: l.id,
    title: l.title ?? "Your place",
    place: l.publicLocation,
    kind: TYPE_LABEL[l.type] ?? l.type,
    arrangement: ARRANGEMENT_LABEL[l.arrangement],
    photo: l.photos[0] ?? null,
    photoCount: l.photos.length,
    status: LISTING_STATUS[l.status],
    dates: l.dates.map((d) => formatRange(d.start, d.end)),
  };
}

/** AgentBnB first, then every network: status, a short line, and the next step there. */
export function toListedPlaces(l: HostListing, networks: NetworkWithPublication[]): ListedPlace[] {
  const internal: ListedPlace =
    l.status === "active"
      ? {
          id: "internal",
          name: "AgentBnB",
          status: { label: "Live", tone: "live" },
          detail: "Guests on AgentBnB can find it",
          action: { kind: "button", label: "Pause" },
        }
      : l.status === "paused"
        ? {
            id: "internal",
            name: "AgentBnB",
            status: { label: "Paused", tone: "idle" },
            detail: "Hidden from guests",
            action: { kind: "button", label: "Resume", emphasis: true },
          }
        : {
            id: "internal",
            name: "AgentBnB",
            status: { label: "Draft", tone: "draft" },
            detail: "Not public yet",
            action: { kind: "button", label: "Publish", emphasis: true },
          };

  return [
    internal,
    ...networks.map((n): ListedPlace => {
      const pub = n.publication;
      const status = publicationStatus(pub?.status);
      switch (pub?.status) {
        case "live":
          return {
            id: n.id,
            name: n.name,
            status,
            action: pub.externalUrl ? { kind: "link", label: "View", href: pub.externalUrl } : undefined,
          };
        case "running":
        case "queued":
          return { id: n.id, name: n.name, status, action: { kind: "button", label: "Watch" } };
        case "needs_user":
          return {
            id: n.id,
            name: n.name,
            status,
            detail: "Your turn in the live browser",
            action: { kind: "button", label: "Open", emphasis: true },
          };
        case "failed":
          return { id: n.id, name: n.name, status, action: { kind: "button", label: "Retry" } };
        default:
          return {
            id: n.id,
            name: n.name,
            status,
            detail: n.recommended ? "Recommended" : undefined,
            action: { kind: "button", label: "Add" },
          };
      }
    }),
  ];
}

/** Statuses that hold a network's row: it's live there or a run is on it. */
const HELD = new Set(["queued", "running", "needs_user", "live"]);

/**
 * The picker's rows. `status` is each network's current publication status (the live one from its
 * card when there is one); `started` are the networks published from this picker, which keep their
 * card even after a failure (it has Retry).
 */
export function toPickerRows(
  networks: NetworkWithPublication[],
  {
    selected,
    status,
    started,
  }: { selected: ReadonlySet<string>; status: (id: string) => string | undefined; started: ReadonlySet<string> },
): PickerRow[] {
  return networks.map((n) => {
    const s = status(n.id);
    const locked = s != null && (started.has(n.id) || HELD.has(s));
    return {
      id: n.id,
      name: n.name,
      pitch: n.pitch,
      reason: n.reason,
      recommended: n.recommended,
      selected: !locked && selected.has(n.id),
      locked,
      status: s && s !== "removed" ? publicationStatus(s) : undefined,
      note: !locked && s === "failed" ? "The last try didn't finish. Pick it to try again." : undefined,
    };
  });
}

/** Whether a network's row is held (see toPickerRows). */
export const isHeld = (status: string | undefined) => status != null && HELD.has(status);
