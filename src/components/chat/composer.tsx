"use client";

import type { ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { ArrowUpIcon, MicIcon, PlusIcon, StopIcon } from "@/components/ui/icons";

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** The two-row home version; otherwise a one-line pill. */
  large?: boolean;
  /** Buttons under the text in the large version, e.g. Dates; shown from `sm` up. */
  toolbar?: ReactNode;
  onAttach?: () => void;
  onDictate?: () => void;
  /** Shown above the text, e.g. an <AttachmentTray>. */
  attachments?: ReactNode;
  /** Whether Send is enabled; defaults to "there is text". */
  canSend?: boolean;
};

/** The message box: grows with its text, Enter sends, Shift+Enter adds a line. */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  placeholder,
  autoFocus,
  large = false,
  toolbar,
  onAttach,
  onDictate,
  attachments,
  canSend,
}: ComposerProps) {
  const attach = onAttach && (
    <IconButton label="Add photos or files" tone={large ? "outline" : "soft"} onClick={onAttach} className="size-9">
      <PlusIcon size={18} />
    </IconButton>
  );
  const send = (
    <div className="flex shrink-0 items-center gap-1">
      {onDictate && (
        <button
          type="button"
          onClick={onDictate}
          aria-label="Dictate"
          className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-surface-strong"
        >
          <MicIcon size={19} />
        </button>
      )}
      {busy ? (
        <IconButton label="Stop" tone="ink" onClick={onStop} className="size-10">
          <StopIcon size={18} />
        </IconButton>
      ) : (
        <IconButton label="Send" tone="rausch" type="submit" disabled={!(canSend ?? value.trim())} className="size-10">
          <ArrowUpIcon size={18} strokeWidth={2.4} />
        </IconButton>
      )}
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={`border border-hairline bg-canvas transition-colors focus-within:border-border-strong ${
        large
          ? "rounded-[28px] px-3.5 pb-3 pt-[18px] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_10px_30px_rgb(0_0_0/0.07)] sm:pl-[22px]"
          : "flex flex-wrap items-end gap-1.5 rounded-[26px] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_24px_rgb(0_0_0/0.06)]"
      }`}
    >
      {attachments && <div className={large ? "pb-3" : "w-full basis-full px-1.5 pb-1 pt-1.5"}>{attachments}</div>}
      {!large && attach && <div className="flex h-10 items-center pl-0.5">{attach}</div>}
      <label htmlFor="composer" className="sr-only">
        Message your agent
      </label>
      <textarea
        id="composer"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={large ? 2 : 1}
        autoFocus={autoFocus}
        placeholder={placeholder ?? "Where and when do you need a place?"}
        className={`field-sizing-content w-full resize-none bg-transparent text-ink outline-none placeholder:text-muted focus-visible:outline-none ${
          large ? "max-h-60 min-h-[52px] px-1 text-[17px] leading-[26px]" : "max-h-48 min-h-10 flex-1 px-2 py-2 text-base leading-6"
        }`}
      />
      {large ? (
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="no-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
            {attach}
            <span className="contents max-sm:hidden">{toolbar}</span>
          </div>
          {send}
        </div>
      ) : (
        send
      )}
    </form>
  );
}

/** A pill button for the composer's toolbar. */
export function ComposerTool({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 shrink-0 items-center gap-[7px] rounded-full border border-hairline pl-3 pr-3.5 text-sm font-medium transition-colors hover:border-border-strong hover:bg-surface-soft"
    >
      {icon}
      {children}
    </button>
  );
}
