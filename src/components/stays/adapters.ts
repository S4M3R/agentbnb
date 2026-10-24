import { formatRange, TYPE_LABEL } from "./format";
import type { ApplyListItem } from "@/lib/apply-list";
import type { StayCardData, StayDetails, StayPanelData, StayResult } from "./types";

const typeLabel = (type: string) => TYPE_LABEL[type] ?? type;

/** A marketplace search result as a card: the stay type as badge, its first dates and source underneath. */
export function toStayCard(r: StayResult): StayCardData {
  const first = r.dates[0];
  return {
    id: r.id,
    title: r.title ?? typeLabel(r.type),
    place: r.location ?? "Location on request",
    photo: r.photo,
    detail: [first ? formatRange(first.start, first.end) : "Flexible dates", r.source.name].join(" · "),
    rating: r.rating,
    badge: typeLabel(r.type),
    reasons: r.highlights.slice(0, 2),
    site: r.source.id,
  };
}

/** A listing's full details as the side panel shows them. */
export function toStayPanel(d: StayDetails): StayPanelData {
  const host = d.host?.name
    ? {
        name: d.host.name,
        photo: d.host.avatarUrl,
        detail:
          [
            d.host.references != null && `${d.host.references} references`,
            d.host.rating != null && `★ ${d.host.rating.toFixed(2)}`,
          ]
            .filter(Boolean)
            .join(" · ") || `Member on ${d.source.name}`,
      }
    : undefined;

  return {
    title: d.title ?? typeLabel(d.type),
    subtitle: [
      `${typeLabel(d.type)} on ${d.source.name}`,
      d.location && `${d.location}${d.locationPrecision === "exact" ? "" : " (approximate)"}`,
    ]
      .filter(Boolean)
      .join(" · "),
    photos: d.photos,
    host,
    fit: d.highlights.map((h) => ({ icon: "check" as const, title: h })),
    dates: d.dates.slice(0, 6).map((w) => formatRange(w.start, w.end)),
    rules: d.houseRules ? [d.houseRules] : undefined,
    description: d.description,
    site: d.source.id,
  };
}

/** A search result or a loaded listing as an apply list entry. */
export function toApplyListItem(r: StayResult | StayDetails): Omit<ApplyListItem, "addedAt"> {
  return {
    id: r.id,
    title: r.title ?? typeLabel(r.type),
    place: r.location ?? "Location on request",
    photo: "photos" in r ? r.photos[0] : r.photo,
    site: r.source.id,
    siteName: r.source.name,
  };
}
