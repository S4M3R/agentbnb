"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo";
import { NightsCard, type NightsSummary } from "@/components/nights/nights";
import { STATUS, StatusPill } from "@/components/requests/status";
import type { StayRequest } from "@/components/requests/types";
import { Avatar } from "@/components/ui/avatar";
import { ChevronsUpDownIcon, NewChatIcon } from "@/components/ui/icons";
import { SidebarClose, useSidebar } from "./app-shell";

export type SidebarNavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  /** Count shown in a dark badge, e.g. open trips. */
  count?: number;
  /** Short red note that needs attention, e.g. "1 request". */
  alert?: string;
};

export type ChatGroup = { label: string; chats: { id: string; title: string; href: string }[] };

export type SidebarUser = { name: string; detail?: string; photo?: string | null; href?: string };

/**
 * The left bar: logo, new chat, navigation, live requests, chat history, then the member's nights
 * and profile. Every section after "New chat" appears only when it has data.
 */
export function Sidebar({
  onNewChat,
  nav = [],
  requests,
  chats = [],
  activeChatId,
  nights,
  user,
}: {
  onNewChat: () => void;
  nav?: SidebarNavItem[];
  requests?: { items: StayRequest[]; limit: number; href: string };
  chats?: ChatGroup[];
  activeChatId?: string;
  nights?: NightsSummary;
  user?: SidebarUser;
}) {
  const { setOpen } = useSidebar();
  const close = () => setOpen(false);
  const open = requests?.items.filter((r) => r.status !== "confirmed" && r.status !== "withdrawn").length ?? 0;

  return (
    <aside aria-label="Sidebar" className="flex h-full flex-col border-r border-hairline-soft bg-surface-soft text-sm">
      <div className="flex items-center justify-between pb-2 pl-4 pr-2.5 pt-3.5">
        <Link href="/" onClick={close} aria-label="AgentBnB home" className="flex items-center gap-1.5 rounded-lg text-rausch">
          <LogoMark size={28} />
          <span className="text-[21px] font-extrabold tracking-[-0.045em]">agentbnb</span>
        </Link>
        <SidebarClose />
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2.5 pb-2.5 pt-1.5">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            close();
          }}
          className="mb-1.5 flex h-[42px] items-center gap-2.5 rounded-xl border border-hairline-soft bg-canvas px-3 font-semibold shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-shadow hover:shadow-float"
        >
          <NewChatIcon size={18} strokeWidth={1.9} />
          New chat
        </button>
        {nav.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            onClick={close}
            className="flex h-10 items-center gap-2.5 rounded-[10px] px-3 transition-colors hover:bg-hairline-soft"
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.count != null && (
              <span className="min-w-[22px] rounded-full bg-ink px-[7px] text-center text-xs font-bold leading-[22px] text-white tabular-nums">
                {item.count}
              </span>
            )}
            {item.alert && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-rausch-deep">
                <span className="size-[7px] rounded-full bg-rausch" />
                {item.alert}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-3 pt-1">
        {requests && requests.items.length > 0 && (
          <section aria-labelledby="sidebar-requests">
            <h2 id="sidebar-requests" className="flex items-baseline justify-between px-3 pb-1.5 pt-3 text-[13px] font-semibold text-muted">
              Live requests
              <span className="text-xs tabular-nums">
                {open} of {requests.limit}
              </span>
            </h2>
            <ul>
              {requests.items.map((r) => (
                <li key={r.id}>
                  <Link
                    href={requests.href}
                    onClick={close}
                    className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-hairline-soft"
                  >
                    <span className="relative shrink-0">
                      <Avatar name={r.host.name} src={r.host.photo} size={34} />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface-soft ${STATUS[r.status].fill}`}
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{r.host.name}</span>
                      <span className="truncate text-xs leading-4 text-muted">
                        {STATUS[r.status].countdown(r.timeLeft) ?? r.area}
                      </span>
                    </span>
                    <StatusPill status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {chats.length === 0 ? (
          <p className="px-3 pt-4 text-[13px] text-muted">Your chats show up here.</p>
        ) : (
          chats.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="px-3 pb-1.5 pt-[18px] text-[13px] font-semibold text-muted">{group.label}</h2>
              <ul>
                {group.chats.map((c) => {
                  const active = c.id === activeChatId;
                  return (
                    <li key={c.id}>
                      <Link
                        href={c.href}
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                        className={`block truncate rounded-[10px] px-3 py-[9px] transition-colors ${active ? "bg-hairline-soft font-semibold" : "hover:bg-hairline-soft"}`}
                      >
                        {c.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      {(nights || user) && (
        <div className="flex flex-col gap-2 border-t border-hairline-soft p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          {nights && <NightsCard nights={nights} />}
          {user && <UserRow user={user} onNavigate={close} />}
        </div>
      )}
    </aside>
  );
}

function UserRow({ user, onNavigate }: { user: SidebarUser; onNavigate: () => void }) {
  const body = (
    <>
      <Avatar name={user.name} src={user.photo} size={36} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{user.name}</span>
        {user.detail && <span className="truncate text-xs leading-4 text-muted">{user.detail}</span>}
      </span>
    </>
  );
  if (!user.href) return <div className="flex items-center gap-2.5 p-2">{body}</div>;
  return (
    <Link
      href={user.href}
      onClick={onNavigate}
      className="flex items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-hairline-soft"
    >
      {body}
      <ChevronsUpDownIcon size={16} className="shrink-0 text-muted" />
    </Link>
  );
}
