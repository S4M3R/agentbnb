import type { Tone } from "./calendar";

// How each kind of night looks. Ink for guests at your place, Rausch for where you sleep, the soft
// tints for "not yet", stripes for nights you closed, and a dashed Rausch outline for a gap.

const stripes =
  "bg-[repeating-linear-gradient(135deg,var(--color-surface-strong)_0_5px,var(--color-hairline-soft)_5px_10px)]";

export const TONES: Record<Tone, { bar: string; swatch: string; legend: string }> = {
  booked: { bar: "bg-ink text-white", swatch: "bg-ink", legend: "Guest staying" },
  request: {
    bar: "bg-amber-soft text-amber border border-dashed border-amber-dot",
    swatch: "bg-amber-soft border border-dashed border-amber-dot",
    legend: "Asked to stay",
  },
  open: { bar: "bg-success-soft text-success", swatch: "bg-success-soft", legend: "Open" },
  blocked: { bar: `${stripes} text-muted`, swatch: stripes, legend: "Blocked" },
  stay: { bar: "bg-rausch text-white", swatch: "bg-rausch", legend: "Your stay" },
  pending: {
    bar: "bg-rausch-soft text-rausch-deep border border-dashed border-rausch/50",
    swatch: "bg-rausch-soft border border-dashed border-rausch/50",
    legend: "Waiting on a host",
  },
  gap: {
    bar: "bg-canvas text-rausch-deep border-[1.5px] border-dashed border-rausch",
    swatch: "bg-canvas border-[1.5px] border-dashed border-rausch",
    legend: "No place yet",
  },
  overlap: { bar: "bg-error text-white", swatch: "bg-error", legend: "Double-booked" },
};

/** Legend order: your place first, then your trips, then the warnings. */
export const TONE_LEGEND: Tone[] = ["booked", "request", "open", "blocked", "stay", "pending", "gap", "overlap"];
