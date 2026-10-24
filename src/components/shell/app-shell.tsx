"use client";

import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { CloseIcon, SidebarIcon } from "@/components/ui/icons";

type SidebarState = { open: boolean; setOpen: (open: boolean) => void };

const SidebarContext = createContext<SidebarState | null>(null);

/** Whether the sidebar drawer is open below `lg`. From `lg` up the sidebar is always shown. */
export function useSidebar() {
  const state = use(SidebarContext);
  if (!state) throw new Error("useSidebar needs an <AppShell> above it");
  return state;
}

/**
 * The app frame: a 280px sidebar on the left and the page beside it. From `lg` up the sidebar
 * sits in the layout; below that it is a drawer opened by <SidebarToggle>. Escape and the
 * backdrop close the drawer.
 */
export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <SidebarContext value={{ open, setOpen }}>
      <div className="flex h-dvh overflow-hidden bg-canvas">
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        />
        <div
          className={`fixed inset-y-0 left-0 z-40 w-[280px] transition-[translate,visibility] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] lg:visible lg:static lg:translate-x-0 lg:shadow-none ${open ? "visible translate-x-0 shadow-[12px_0_32px_rgb(0_0_0/0.18)]" : "invisible -translate-x-full"}`}
        >
          {sidebar}
        </div>
        <div className="flex min-w-0 flex-1">{children}</div>
      </div>
    </SidebarContext>
  );
}

/** Opens the sidebar drawer. Hidden from `lg` up, where the sidebar is always visible. */
export function SidebarToggle() {
  const { setOpen } = useSidebar();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open sidebar"
      className="flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-strong lg:hidden"
    >
      <SidebarIcon size={22} strokeWidth={1.9} />
    </button>
  );
}

/** Closes the sidebar drawer; only shown below `lg`. */
export function SidebarClose() {
  const { setOpen } = useSidebar();
  return (
    <button
      type="button"
      onClick={() => setOpen(false)}
      aria-label="Close sidebar"
      className="flex size-9 items-center justify-center rounded-[10px] text-muted transition-colors hover:bg-hairline-soft hover:text-ink lg:hidden"
    >
      <CloseIcon size={18} />
    </button>
  );
}
