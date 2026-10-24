/**
 * A guest's request to stay with an internal host. Lifecycle: sent → interested (the host's agent
 * flagged a fit) → accepted (the host said yes) → confirmed (the guest locked it in). Confirming one
 * withdraws the guest's other open requests for that trip.
 */
export type RequestStatus = "sent" | "interested" | "accepted" | "confirmed" | "withdrawn";

export type StayRequest = {
  id: string;
  host: { name: string; photo?: string | null };
  /** Neighborhood or city, e.g. "Alfama". */
  area: string;
  status: RequestStatus;
  /** Latest word on the request. */
  note?: string;
  /** Who wrote `note`: the host, the host's agent, or our agent. */
  noteFrom?: "host" | "hostAgent" | "agent";
  /** Time left for whoever acts next, e.g. "3h 40m". */
  timeLeft?: string;
  /** Share of the reply window still left, 0 to 1. */
  timeLeftShare?: number;
};

export type Trip = { title: string; dates: string; photo?: string | null };
