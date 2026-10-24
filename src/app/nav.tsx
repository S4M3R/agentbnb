"use client";

import { useEffect, useState } from "react";
import type { SidebarNavItem } from "@/components/shell/sidebar";
import { CalendarIcon, HomeIcon, MapIcon, SuitcaseIcon } from "@/components/ui/icons";

/** Sidebar links; `unread` counts application updates the guest hasn't seen. */
export function navItems(unread: number): SidebarNavItem[] {
  return [
    {
      label: "My applications",
      href: "/applications",
      icon: <SuitcaseIcon size={18} strokeWidth={1.9} />,
      count: unread > 0 ? Math.min(unread, 99) : undefined,
    },
    { label: "Host requests", href: "/requests", icon: <HomeIcon size={18} strokeWidth={1.9} /> },
    { label: "Calendar", href: "/calendar", icon: <CalendarIcon size={18} strokeWidth={1.9} /> },
    { label: "Map of stays", href: "/map", icon: <MapIcon size={18} strokeWidth={1.9} /> },
  ];
}

/** Unread application updates, refreshed every 30s while the tab is visible. */
export function useUnreadApplications() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let stopped = false;
    async function load() {
      const res = await fetch("/api/applications").catch(() => null);
      if (res?.ok && !stopped) setUnread((await res.json()).unread ?? 0);
    }
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  return unread;
}
