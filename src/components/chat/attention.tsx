"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SiteIcon } from "@/components/ui/site-name";
import {
  AlertIcon,
  BellIcon,
  BrowserIcon,
  CalendarIcon,
  HomeIcon,
  MessageIcon,
  SuitcaseIcon,
} from "@/components/ui/icons";

export type AttentionRow = {
  id: string;
  title: string;
  /** One line: which place, what's next. */
  detail: string;
  href: string;
  /** Source id or URL of the website it's about; its favicon replaces the icon. */
  site?: string;
  icon: "browser" | "alert" | "calendar" | "suitcase" | "message" | "home" | "bell";
  /** The verb on the right: "Open browser", "Reply", "Confirm arrival". */
  action: string;
  /** Gets a Rausch dot. */
  urgent?: boolean;
  /** "2h ago". */
  when?: string;
};

const ICONS: Record<AttentionRow["icon"], ReactNode> = {
  browser: <BrowserIcon size={18} />,
  alert: <AlertIcon size={18} />,
  calendar: <CalendarIcon size={18} />,
  suitcase: <SuitcaseIcon size={18} />,
  message: <MessageIcon size={18} />,
  home: <HomeIcon size={18} />,
  bell: <BellIcon size={18} />,
};

/**
 * "Needs your attention" on the home screen: what's waiting on the member, as compact rows with
 * the site's favicon, a one-line detail and the action. Shows `limit` rows and "See all N";
 * renders nothing when there's nothing to do.
 */
export function AttentionList({ items, limit = 3 }: { items: AttentionRow[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const shown = expanded ? items : items.slice(0, limit);
  const urgent = items.filter((i) => i.urgent).length;

  return (
    <section aria-labelledby="attention-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="attention-title" className="flex items-center gap-2 text-[17px] font-semibold">
          Needs your attention
          {urgent > 0 && <span className="size-2 rounded-full bg-rausch" aria-hidden="true" />}
        </h2>
        {items.length > limit && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="text-sm font-semibold underline underline-offset-2 hover:text-body"
          >
            {expanded ? "Show less" : `See all ${items.length}`}
          </button>
        )}
      </div>
      <ul className="divide-y divide-hairline-soft overflow-hidden rounded-[20px] border border-hairline-soft">
        {shown.map((item) => (
          <li key={item.id}>
            <Row item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ item }: { item: AttentionRow }) {
  const className =
    "group flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-offset-[-2px] sm:gap-3.5 sm:px-4";
  const body = (
    <>
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-soft text-ink">
        {item.site ? <SiteIcon site={item.site} size={20} /> : ICONS[item.icon]}
        {item.urgent && (
          <span
            aria-label="Urgent"
            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-rausch ring-2 ring-canvas"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold leading-5">{item.title}</span>
        <span className="flex min-w-0 text-[13px] leading-[18px] text-muted">
          <span className="truncate">{item.detail}</span>
          {item.when && <span className="shrink-0 max-sm:hidden">&nbsp;· {item.when}</span>}
        </span>
      </span>
      <span className="flex h-8 shrink-0 items-center rounded-full border border-hairline px-3 text-[13px] font-semibold transition-colors group-hover:border-ink">
        {item.action}
      </span>
    </>
  );
  return item.href.startsWith("http") ? (
    <a href={item.href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={item.href} className={className}>
      {body}
    </Link>
  );
}
