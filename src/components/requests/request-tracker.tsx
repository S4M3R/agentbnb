import { Avatar } from "@/components/ui/avatar";
import { SparkIcon } from "@/components/ui/icons";
import { STATUS, StatusPill, StatusSteps } from "./status";
import type { StayRequest, Trip } from "./types";

/** Every open request for one trip: who, where it stands, and how long until someone must act. */
export function RequestTracker({
  trip,
  requests,
  limit = 3,
  note,
}: {
  trip: Trip;
  requests: StayRequest[];
  /** Most requests a guest can have out at once. */
  limit?: number;
  note?: string;
}) {
  const open = requests.filter((r) => r.status !== "confirmed" && r.status !== "withdrawn").length;

  return (
    <section
      aria-label={`Requests for ${trip.title}`}
      className="overflow-hidden rounded-[20px] border border-hairline-soft shadow-[0_6px_16px_rgb(0_0_0/0.06)]"
    >
      <header className="flex items-center gap-3.5 border-b border-hairline-soft bg-surface-soft px-4 py-3.5 sm:px-[18px]">
        {trip.photo && (
          // eslint-disable-next-line @next/next/no-img-element -- trip cover photo
          <img src={trip.photo} alt="" className="size-11 shrink-0 rounded-[10px] object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold sm:truncate">
            {trip.title} · {trip.dates}
          </p>
          {note && <p className="text-[13px] text-muted sm:truncate">{note}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-[13px] font-semibold tabular-nums">
            {open} of {limit} <span className="max-sm:hidden">requests out</span>
          </span>
          <span aria-hidden="true" className="flex gap-1">
            {Array.from({ length: limit }, (_, i) => (
              <span key={i} className={`h-1.5 w-[22px] rounded-full ${i < open ? "bg-ink" : "bg-hairline"}`} />
            ))}
          </span>
        </div>
      </header>
      <ul>
        {requests.map((r) => (
          <RequestRow key={r.id} request={r} />
        ))}
      </ul>
    </section>
  );
}

function RequestRow({ request: r }: { request: StayRequest }) {
  const urgent = r.status === "accepted";
  const countdown = STATUS[r.status].countdown(r.timeLeft);
  const quoted = r.noteFrom === "host" || r.noteFrom === "hostAgent";

  return (
    <li
      className={`flex gap-3.5 border-t border-surface-strong px-4 py-4 first:border-t-0 sm:px-[18px] ${r.status === "withdrawn" ? "opacity-60" : ""}`}
    >
      <Avatar name={r.host.name} src={r.host.photo} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-semibold">{r.host.name}</span>
            <span className="text-[13px] text-muted">{r.area}</span>
            <StatusPill status={r.status} />
          </p>
          {r.note && (
            <p className="flex flex-col items-start gap-1 text-sm leading-5 text-body sm:flex-row sm:gap-2">
              {r.noteFrom === "hostAgent" && (
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-amber-soft px-1.5 text-[11px] font-bold text-amber">
                  <SparkIcon size={11} strokeWidth={2.6} />
                  Their agent
                </span>
              )}
              <span>{quoted ? `“${r.note}”` : r.note}</span>
            </p>
          )}
          <StatusSteps status={r.status} />
        </div>
        {countdown && (
          <div className="flex shrink-0 items-center gap-3 sm:w-32 sm:flex-col sm:items-end sm:gap-2">
            <span className={`shrink-0 text-[13px] font-semibold tabular-nums sm:text-right ${urgent ? "text-rausch-active" : "text-ink"}`}>
              {countdown}
            </span>
            {r.timeLeftShare != null && (
              <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-hairline-soft sm:w-full sm:flex-none">
                <span
                  className={`block h-full rounded-full transition-[width] duration-500 ${urgent ? "bg-rausch-active" : "bg-ink"}`}
                  style={{ width: `${Math.round(r.timeLeftShare * 100)}%` }}
                />
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
