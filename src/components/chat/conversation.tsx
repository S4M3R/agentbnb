import type { ReactNode, Ref } from "react";

/** The page column of a chat: top bar, the scrolling turns, then the composer dock. */
export function ChatColumn({ children }: { children: ReactNode }) {
  return <main className="flex min-w-0 flex-1 flex-col">{children}</main>;
}

/** The scrolling list of turns. `endRef` marks the bottom, for scrolling new turns into view. */
export function Conversation({ children, endRef }: { children: ReactNode; endRef?: Ref<HTMLDivElement> }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8 px-4 pb-8 pt-2 sm:px-8 sm:pt-4">
        {children}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/** Holds the composer under the conversation, with an optional note beneath it. */
export function ComposerDock({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        {children}
        {note && <p className="mt-2 text-center text-xs text-muted max-sm:hidden">{note}</p>}
      </div>
    </div>
  );
}
