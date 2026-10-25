import Link from "next/link";
import type { ReactNode } from "react";
import { Couchbot } from "@/components/brand/logo";
import { ChevronRightIcon } from "@/components/ui/icons";
import { ReservedSlot } from "./reserved-slot";

/**
 * The empty chat: Couchbot and its greeting, composer, then optional slots for a one-off notice (turning
 * notifications on), a trip in progress, what needs the member's attention, recent conversations,
 * starter prompts and a banner underneath. Centered from `sm`
 * up; on a phone the composer docks to the bottom of the screen and the sections scroll above it.
 */
export function ChatHome({
  greeting,
  subtitle,
  activity,
  composer,
  notice,
  resume,
  attention,
  recent,
  starters,
  banner,
}: {
  greeting: string;
  subtitle?: string;
  activity?: ReactNode;
  composer: ReactNode;
  notice?: ReactNode;
  resume?: ReactNode;
  attention?: ReactNode;
  recent?: ReactNode;
  starters?: ReactNode;
  banner?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col px-5 pb-36 pt-4 sm:items-center sm:px-8 sm:pb-10 sm:pt-11">
      {/* Browser-only sections sit in ReservedSlots so they don't push the page down after load. */}
      <ReservedSlot name="activity" className="flex flex-col sm:items-center">
        {activity || null}
      </ReservedSlot>
      {/* Couchbot asks the question: the greeting is the agent talking */}
      <Couchbot mood="idle" animated size={84} className="-mb-1 mt-4 size-[68px] sm:mt-6 sm:size-[84px]" />
      <h1 className="mt-3 font-brand text-[34px] font-extrabold leading-[38px] tracking-[-0.04em] sm:text-center sm:text-[44px] sm:leading-[50px]">
        {greeting}
      </h1>
      {subtitle && <p className="mt-2.5 text-base text-muted max-sm:hidden sm:text-center">{subtitle}</p>}
      <div className="w-full max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:bg-canvas max-sm:before:pointer-events-none max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:bottom-full max-sm:before:h-8 max-sm:before:bg-linear-to-t max-sm:before:from-canvas max-sm:before:to-transparent max-sm:px-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:pt-2 sm:mt-[30px]">
        {composer}
      </div>
      <ReservedSlot name="notice" className="has-[>*]:pt-5 sm:has-[>*]:pt-7">
        {notice || null}
      </ReservedSlot>
      {resume && <div className="mt-5 w-full sm:mt-7">{resume}</div>}
      <ReservedSlot name="attention" className="has-[>*]:pt-6 sm:has-[>*]:pt-8">
        {attention || null}
      </ReservedSlot>
      <ReservedSlot name="recent" className="has-[>*]:pt-6 sm:has-[>*]:pt-8">
        {recent || null}
      </ReservedSlot>
      {starters && <div className="mt-[26px] w-full sm:mt-[30px]">{starters}</div>}
      {banner && <div className="mt-7 w-full sm:mt-10">{banner}</div>}
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
