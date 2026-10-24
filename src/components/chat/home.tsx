import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "@/components/ui/icons";

/**
 * The empty chat: greeting, composer, then optional slots for a trip in progress and starter
 * prompts. Centered from `sm` up; on a phone the composer docks to the bottom of the screen.
 */
export function ChatHome({
  greeting,
  subtitle,
  activity,
  composer,
  resume,
  starters,
}: {
  greeting: string;
  subtitle?: string;
  activity?: ReactNode;
  composer: ReactNode;
  resume?: ReactNode;
  starters?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col px-5 pb-36 pt-4 sm:items-center sm:px-8 sm:pb-10 sm:pt-11">
      {activity}
      <h1 className="mt-4 text-[32px] font-bold leading-[38px] tracking-[-0.035em] sm:mt-[22px] sm:text-center sm:text-[40px] sm:leading-[48px]">
        {greeting}
      </h1>
      {subtitle && <p className="mt-2.5 text-base text-muted max-sm:hidden sm:text-center">{subtitle}</p>}
      <div className="w-full max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:bg-canvas max-sm:px-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:pt-2 sm:mt-[30px]">
        {composer}
      </div>
      {resume && <div className="mt-5 w-full sm:mt-7">{resume}</div>}
      {starters && <div className="mt-[26px] w-full sm:mt-[30px]">{starters}</div>}
    </div>
  );
}

/** "Your agent is following 3 requests in Lisbon": a live dot and a link to that chat. */
export function ActivityPill({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-2 self-start rounded-full bg-surface-soft pl-3 pr-3.5 text-[13px] font-semibold transition-colors hover:bg-surface-strong sm:self-center"
    >
      <span className="size-2 rounded-full bg-success-dot motion-safe:animate-live" />
      {children}
      <ChevronRightIcon size={14} strokeWidth={2.4} className="max-sm:hidden" />
    </Link>
  );
}
