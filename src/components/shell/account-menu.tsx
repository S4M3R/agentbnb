"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { NewChatIcon } from "@/components/ui/icons";
import type { Me } from "./nav";

/**
 * Airbnb's account pill (hamburger plus avatar) and its dropdown: New chat, the member's pages and
 * the agent API docs. Escape, a click outside or picking an item closes it. Shows the member's photo
 * (or initial) once `me` is known, and Airbnb's default silhouette before that.
 */
export function AccountMenu({ onNewChat, me }: { onNewChat: () => void; me?: Me | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div
      ref={root}
      className="relative"
      // Tabbing out of the menu closes it, like a click outside.
      onBlur={(e) => !root.current?.contains(e.relatedTarget as Node | null) && setOpen(false)}
    >
      <button
        ref={button}
        type="button"
        aria-label={me ? `Account menu for ${me.name}` : "Account menu"}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={`flex h-[42px] items-center gap-2.5 rounded-full border border-hairline bg-canvas pl-3 pr-1.5 text-ink transition-shadow duration-200 hover:shadow-float ${open ? "shadow-float" : ""}`}
      >
        <MenuGlyph />
        {me ? <Avatar name={me.name} src={me.avatarUrl} size={30} /> : <PersonGlyph />}
      </button>

      {open && (
        <div
          id={id}
          className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl bg-canvas py-2 text-[15px] shadow-float motion-safe:animate-menu-in"
        >
          <nav aria-label="Account">
            {me && (
              <>
                <Link
                  href={`/people/${me.id}`}
                  onClick={close}
                  className="flex items-center gap-3 px-4 pb-3 pt-2 transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-offset-[-2px]"
                >
                  <Avatar name={me.name} src={me.avatarUrl} size={40} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{me.name}</span>
                    <span className="text-[13px] text-muted">Show profile</span>
                  </span>
                </Link>
                <hr className="mb-2 border-hairline-soft" />
              </>
            )}
            <MenuButton
              onClick={() => {
                close();
                onNewChat();
              }}
            >
              <NewChatIcon size={17} strokeWidth={1.9} />
              New chat
            </MenuButton>
            <MenuLink href="/me/profile" onNavigate={close}>
              {me ? "Edit profile" : "Profile"}
            </MenuLink>
            <MenuLink href="/me/checks" onNavigate={close}>
              Checks about you
            </MenuLink>
            <MenuLink href="/me/keychain" onNavigate={close}>
              Keychain
            </MenuLink>
            <hr className="my-2 border-hairline-soft" />
            <MenuLink href="/docs.md" onNavigate={close} quiet>
              API for your agent
            </MenuLink>
          </nav>
        </div>
      )}
    </div>
  );
}

const ITEM =
  "flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-offset-[-2px]";

function MenuButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`${ITEM} font-semibold`}>
      {children}
    </button>
  );
}

function MenuLink({
  href,
  onNavigate,
  quiet = false,
  children,
}: {
  href: string;
  onNavigate: () => void;
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} onClick={onNavigate} className={`${ITEM} ${quiet ? "text-body" : "font-semibold"}`}>
      {children}
    </Link>
  );
}

function MenuGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  );
}

/** Airbnb's default member avatar: a muted circle with a white silhouette. */
function PersonGlyph() {
  return (
    <svg width={30} height={30} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0 text-muted">
      <circle cx="16" cy="16" r="16" fill="currentColor" />
      <circle cx="16" cy="12.5" r="5.5" fill="#fff" />
      <path d="M6.6 26.4a10.5 10.5 0 0 1 18.8 0A15.9 15.9 0 0 1 16 32a15.9 15.9 0 0 1-9.4-5.6Z" fill="#fff" />
    </svg>
  );
}
