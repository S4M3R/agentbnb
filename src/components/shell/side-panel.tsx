"use client";

import { useEffect, type ReactNode } from "react";

/**
 * A panel beside the page from `lg` up, and a full-screen sheet below that.
 * Escape calls `onClose`.
 */
export function SidePanel({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label={label}
      className="fixed inset-0 z-50 bg-canvas motion-safe:animate-panel-in lg:static lg:z-auto lg:w-[min(600px,42vw)] lg:shrink-0 lg:border-l lg:border-hairline-soft lg:shadow-[-12px_0_32px_rgb(0_0_0/0.04)]"
    >
      {children}
    </aside>
  );
}
