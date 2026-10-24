"use client";

import { useState, type MouseEvent } from "react";
import { MessageIcon, TrashIcon } from "@/components/ui/icons";

export type RecentChat = {
  id: string;
  title: string;
  /** The chat's own URL, for opening it in a new tab. */
  href: string;
  /** What happened in it: "12 stays found · 2 applications". */
  hint?: string;
  /** "2h ago". */
  when: string;
};

/**
 * Past conversations on the home screen: title, what happened and when. Clicking one calls
 * `onOpen` (a modified click opens `href` in a new tab instead); the trash button calls `onDelete`,
 * and `undo` shows the "Deleted · Undo" line for the chat just removed.
 */
export function RecentChats({
  chats,
  onOpen,
  onDelete,
  undo,
  limit = 4,
}: {
  chats: RecentChat[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  undo?: { title: string; onUndo: () => void } | null;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!chats.length && !undo) return null;
  const shown = expanded ? chats : chats.slice(0, limit);

  function open(e: MouseEvent<HTMLAnchorElement>, id: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(id);
  }

  return (
    <section aria-labelledby="recent-chats-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="recent-chats-title" className="text-[17px] font-semibold">
          Recent conversations
        </h2>
        {chats.length > limit && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="text-sm font-semibold underline underline-offset-2 hover:text-body"
          >
            {expanded ? "Show less" : `Show all ${chats.length}`}
          </button>
        )}
      </div>

      {undo && (
        <div
          role="status"
          className="mb-2 flex items-center gap-3 rounded-xl bg-surface-soft px-4 py-2.5 text-sm motion-safe:animate-pop"
        >
          <span className="min-w-0 flex-1 truncate text-body">
            Deleted <span className="font-semibold text-ink">{undo.title}</span>
          </span>
          <button type="button" onClick={undo.onUndo} className="shrink-0 font-semibold underline underline-offset-2">
            Undo
          </button>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="divide-y divide-hairline-soft overflow-hidden rounded-[20px] border border-hairline-soft">
          {shown.map((c) => (
            <li key={c.id} className="group relative">
              <a
                href={c.href}
                onClick={(e) => open(e, c.id)}
                className="flex items-center gap-3 py-3 pl-3.5 pr-14 transition-colors hover:bg-surface-soft focus-visible:bg-surface-soft focus-visible:outline-offset-[-2px] sm:gap-3.5 sm:pl-4"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-soft text-ink">
                  <MessageIcon size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold leading-5">{c.title}</span>
                  <span className="flex min-w-0 text-[13px] leading-[18px] text-muted">
                    {c.hint && <span className="truncate">{c.hint}&nbsp;·&nbsp;</span>}
                    <span className="shrink-0">{c.when}</span>
                  </span>
                </span>
              </a>
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label={`Delete "${c.title}"`}
                title="Delete"
                className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-[opacity,background-color,color] hover:bg-surface-strong hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <TrashIcon size={17} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
