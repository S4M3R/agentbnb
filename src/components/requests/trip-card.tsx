import Link from "next/link";
import type { ReactNode } from "react";
import { AvatarStack } from "@/components/ui/avatar";
import { ChevronRightIcon } from "@/components/ui/icons";
import type { StayRequest, Trip } from "./types";

/** A trip in progress, linking back to its conversation: cover photo, the hosts asked, and the latest news. */
export function TripCard({
  href,
  trip,
  requests,
  status,
  eyebrow = "Pick up where you left off",
}: {
  href: string;
  trip: Trip;
  requests: StayRequest[];
  status: ReactNode;
  eyebrow?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex w-full items-center gap-3 rounded-[20px] border border-hairline-soft p-2.5 transition-shadow hover:shadow-[0_6px_16px_rgb(0_0_0/0.12)] sm:gap-[18px] sm:p-3 sm:pr-[18px]"
    >
      {trip.photo && (
        // eslint-disable-next-line @next/next/no-img-element -- trip cover photo
        <img src={trip.photo} alt="" className="size-16 shrink-0 rounded-xl object-cover sm:h-[84px] sm:w-28" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-semibold text-muted max-sm:hidden">{eyebrow}</span>
        <span className="truncate font-semibold sm:text-[17px] sm:leading-6">
          {trip.title} · {trip.dates}
        </span>
        <span className="mt-0.5 flex items-center gap-2.5 sm:mt-1.5">
          <span className="max-sm:hidden">
            <AvatarStack people={requests.map((r) => ({ name: r.host.name, src: r.host.photo }))} />
          </span>
          <span className="truncate text-[13px] text-body sm:text-sm">{status}</span>
        </span>
      </span>
      <span className="flex h-10 shrink-0 items-center rounded-[10px] bg-ink px-[18px] text-sm font-semibold text-white max-sm:hidden">
        Review
      </span>
      <ChevronRightIcon size={18} className="shrink-0 text-muted sm:hidden" />
    </Link>
  );
}
