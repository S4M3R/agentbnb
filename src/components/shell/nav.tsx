"use client";

import { useEffect } from "react";
import { NOTIFICATIONS_READ } from "@/components/notifications/use-notifications";
import { NOTIFICATIONS_CHANGED } from "@/components/notifications/use-push";
import { useCachedJson, writeCachedJson } from "@/lib/cached-json";

export type NavTab = {
  label: string;
  href: string;
  /** A 3D icon under /public/icons. */
  icon: string;
  /** Unread updates, shown as a Rausch count on the icon. */
  count?: number;
  /** DESIGN.md's "NEW" tag, for a product that just shipped. */
  isNew?: boolean;
};

/** The header's product tabs; `unread` counts application updates the guest hasn't seen. */
export function navTabs(unread: number): NavTab[] {
  return [
    { label: "Stays", href: "/", icon: "/icons/stays.webp" },
    {
      label: "Applications",
      href: "/applications",
      icon: "/icons/applications.webp",
      count: unread > 0 ? Math.min(unread, 99) : undefined,
    },
    { label: "Hosting", href: "/hosting", icon: "/icons/hosting.webp", isNew: true },
    { label: "Map", href: "/map", icon: "/icons/map.webp" },
  ];
}

/** Other paths that belong to a tab's section: Hosting holds the listings and the requests inbox. */
const SECTION_PATHS: Record<string, string[]> = { "/hosting": ["/requests"] };

/**
 * Whether `href` is the current section: an exact match for "/", the path or a child path
 * otherwise, counting the section's other paths (SECTION_PATHS).
 */
export function isActive(href: string, pathname: string | null | undefined) {
  if (pathname == null) return false;
  if (href === "/") return pathname === "/";
  return [href, ...(SECTION_PATHS[href] ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Unread application updates, refreshed every 30s while the tab is visible and when the bell changes. */
export function useUnreadApplications() {
  // The last count shows straight away (see cached-json); the fetch refreshes it.
  const unread = useCachedJson<number>("abnb:unread") ?? 0;
  useEffect(() => {
    let stopped = false;
    async function load() {
      const res = await fetch("/api/applications").catch(() => null);
      if (res?.ok && !stopped) writeCachedJson("abnb:unread", (await res.json()).unread ?? 0);
    }
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    // Reading notifications in the bell (or a push arriving) changes the count.
    window.addEventListener(NOTIFICATIONS_READ, load);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_READ, load);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, []);
  return unread;
}

export type Me = { id: string; name: string; avatarUrl: string | null };

/** Fired after the member saves their profile, so the header shows the new name and photo. */
export const PROFILE_CHANGED = "agentbnb:profile-changed";

/** The person behind this browser (null until they've done something that created them). */
export function useMe() {
  // The header shows the last known photo and name right away, then refreshes from /api/me.
  const me = useCachedJson<Me>("abnb:me");
  useEffect(() => {
    let stopped = false;
    async function load() {
      const res = await fetch("/api/me").catch(() => null);
      if (res?.ok && !stopped) writeCachedJson("abnb:me", (await res.json()).user ?? null);
    }
    load();
    window.addEventListener(PROFILE_CHANGED, load);
    return () => {
      stopped = true;
      window.removeEventListener(PROFILE_CHANGED, load);
    };
  }, []);
  return me;
}
