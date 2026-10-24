"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { PageBar, SiteShell } from "./site-shell";

const WIDTHS = { narrow: "max-w-3xl", wide: "max-w-6xl" } as const;

/**
 * The frame for every page outside the chat: the same header and tabs, then the page.
 * `bleed` hands the page the whole area under the header (the map), with `title` as its heading
 * for screen readers; otherwise the page scrolls in a centered column under its own <PageHeading>.
 */
export function PageShell({
  title,
  back,
  actions,
  width = "narrow",
  bleed = false,
  children,
}: {
  title?: ReactNode;
  /** A detail page's way back to its list, shown at the start of the bar. */
  back?: { href: string; label: string };
  actions?: ReactNode;
  width?: keyof typeof WIDTHS;
  bleed?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <SiteShell onNewChat={() => router.push("/")}>
      <main className="flex min-w-0 flex-1 flex-col">
        {bleed ? (
          <>
            {title && <h1 className="sr-only">{title}</h1>}
            {actions && <PageBar title={title} actions={actions} />}
            <div className="flex min-h-0 flex-1">{children}</div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className={`mx-auto w-full ${WIDTHS[width]} px-4 pb-16 sm:px-8 ${back || actions ? "" : "pt-6 nav:pt-10"}`}>
              {/* The page's own heading names it; the bar above it carries the way back and actions. */}
              {(back || actions) && (
                <div className="flex h-16 items-center gap-2 nav:h-20">
                  <div className="min-w-0 flex-1">{back && <BackLink {...back} />}</div>
                  {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
                </div>
              )}
              {children}
            </div>
          </div>
        )}
      </main>
    </SiteShell>
  );
}

/** Page heading in the Airbnb scale: 28px / 700 title, muted lead underneath. */
export function PageHeading({ title, lead, action }: { title: ReactNode; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em]">{title}</h1>
        {lead && <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full py-1 pr-3 text-sm font-semibold transition-colors hover:text-body"
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-surface-strong">
        <ChevronLeftIcon size={16} strokeWidth={2.2} />
      </span>
      {label}
    </Link>
  );
}
