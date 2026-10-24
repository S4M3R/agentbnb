import type { ReactNode } from "react";
import { faviconFor } from "@/lib/source-logos";

/**
 * A website's favicon. `site` is a source id ("workaway") or any URL or domain on the site.
 * Renders nothing for sites we have no icon for.
 */
export function SiteIcon({ site, size = 16, className = "" }: { site: string | null | undefined; size?: number; className?: string }) {
  const src = faviconFor(site);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static favicon from /public
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-[4px] object-contain ${className}`}
    />
  );
}

/** A website's name with its favicon in front, e.g. on "View on Workaway" or a listing's source line. */
export function SiteName({
  site,
  children,
  size = 16,
  className = "",
}: {
  site: string | null | undefined;
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 align-middle ${className}`}>
      <SiteIcon site={site} size={size} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Meta parts joined by " · ", skipping empty ones; parts can be elements like <SiteName>. */
export function MetaLine({ parts, className = "" }: { parts: ReactNode[]; className?: string }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return (
    <div className={className}>
      {shown.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </div>
  );
}
