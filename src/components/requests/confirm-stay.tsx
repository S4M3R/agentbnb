"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { CheckIcon } from "@/components/ui/icons";

/** The guest's final yes on an accepted request: pick an arrival time, then confirm or keep waiting. */
export function ConfirmStayCard({
  photo,
  title,
  details,
  arrivalOptions,
  defaultArrival,
  onConfirm,
  onWait,
  waitLabel = "Keep waiting",
}: {
  photo?: string | null;
  title: string;
  /** Dates and cost, e.g. "Fri 30 Oct – Sun 1 Nov · 2 nights". */
  details: string;
  arrivalOptions: string[];
  defaultArrival?: string;
  onConfirm: (arrival: string) => void;
  onWait?: () => void;
  waitLabel?: string;
}) {
  const [arrival, setArrival] = useState(defaultArrival ?? arrivalOptions[0]);

  return (
    <div className="flex flex-col gap-4 rounded-[20px] border border-hairline p-4 sm:flex-row sm:gap-[18px]">
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- listing photo
        <img src={photo} alt="" className="h-40 w-full shrink-0 rounded-[14px] object-cover sm:size-[132px]" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted">{details}</p>
        </div>
        <div role="group" aria-label="Arrival time" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] font-semibold text-muted">Arrive</span>
          {arrivalOptions.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === arrival}
              onClick={() => setArrival(t)}
              className="h-[34px] rounded-full border border-hairline px-3 text-[13px] font-semibold tabular-nums transition-colors hover:border-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white"
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onConfirm(arrival)}
            className="h-11 rounded-[10px] bg-rausch-active px-5 text-[15px] font-semibold text-white transition-colors hover:bg-rausch-deep"
          >
            Confirm stay
          </button>
          {onWait && (
            <button
              type="button"
              onClick={onWait}
              className="h-11 rounded-[10px] border border-hairline px-[18px] text-[15px] font-semibold transition-colors hover:border-ink"
            >
              {waitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown once a stay is confirmed. */
export function StayConfirmed({
  host,
  detail,
  onMessage,
  onUndo,
}: {
  host: { name: string; photo?: string | null };
  detail: string;
  onMessage?: () => void;
  onUndo?: () => void;
}) {
  return (
    <div
      role="status"
      className="flex gap-[18px] rounded-[20px] bg-ink p-4 text-white motion-safe:animate-pop"
    >
      <Avatar name={host.name} src={host.photo} size={64} className="ring-[3px] ring-white" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-lg font-bold">
          <CheckIcon size={20} strokeWidth={3} className="text-rausch" />
          You&apos;re staying with {host.name.split(" ")[0]}
        </p>
        <p className="mt-1 text-sm leading-5 text-hairline">{detail}</p>
        {(onMessage || onUndo) && (
          <div className="mt-3 flex gap-2">
            {onMessage && (
              <button
                type="button"
                onClick={onMessage}
                className="h-[38px] rounded-[10px] bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-hairline-soft"
              >
                Message {host.name.split(" ")[0]}
              </button>
            )}
            {onUndo && (
              <button
                type="button"
                onClick={onUndo}
                className="h-[38px] rounded-[10px] border border-muted px-4 text-sm font-semibold transition-colors hover:border-white"
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
