import type { ReactNode } from "react";
import { SidebarToggle } from "./app-shell";

/** The bar above a page: the drawer toggle on small screens, a title, and actions on the right. */
export function TopBar({ title, actions }: { title?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:h-16 sm:px-4 lg:pl-6 lg:pr-5">
      <SidebarToggle />
      <div className="min-w-0 flex-1 truncate px-1 text-base font-semibold sm:text-[17px] lg:px-0">{title}</div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
