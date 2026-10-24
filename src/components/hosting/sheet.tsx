"use client";

import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "@/components/ui/icons";

/**
 * A modal: centered card from `sm` up, a bottom sheet on phones. Escape, the backdrop and the
 * close button call `onClose`. The body scrolls; content can pin a footer with `sticky bottom-0`.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/40 motion-safe:animate-fade-in" />
      <div className="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[24px] bg-canvas shadow-float motion-safe:animate-rise sm:max-h-[min(86dvh,820px)] sm:max-w-xl sm:rounded-[24px]">
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-hairline sm:hidden" />
        <header className="flex shrink-0 items-start gap-3 border-b border-hairline-soft py-3 pl-6 pr-3 sm:py-4">
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="truncate text-[17px] font-semibold">{title}</h2>
            {subtitle && <p className="truncate text-[13px] text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface-strong"
          >
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-[env(safe-area-inset-bottom)]">{children}</div>
      </div>
    </div>
  );
}
