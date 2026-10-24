"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { navItems, useUnreadApplications } from "../nav";

/** The app frame around the calendar: the chat's sidebar, a title bar and a scrolling page. */
export function CalendarShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const unread = useUnreadApplications();
  return (
    <AppShell sidebar={<Sidebar onNewChat={() => router.push("/")} nav={navItems(unread)} />}>
      <CalendarPage>{children}</CalendarPage>
    </AppShell>
  );
}

/** The page column inside the shell; the dev screens reuse it with their own sidebar. */
export function CalendarPage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <TopBar title="Calendar" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-1 sm:px-8">
          <p className="mb-6 max-w-2xl text-[15px] text-muted">
            Who&apos;s staying at your place, which nights you&apos;ve blocked, and where you sleep each night of a trip,
            so nothing slips through the gaps.
          </p>
          {children}
        </div>
      </div>
    </main>
  );
}
