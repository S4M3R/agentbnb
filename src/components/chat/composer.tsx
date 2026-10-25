"use client";

import type { ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { ArrowUpIcon, MicIcon, PlusIcon, StopIcon } from "@/components/ui/icons";

/** What the mic is doing, from the page's dictation hook. */
export type DictationView = {
  state: "idle" | "recording" | "transcribing";
  /** Seconds recorded so far. */
  seconds: number;
  /** Input loudness 0–1, for the live meter. */
  level: number;
  error: string | null;
  /** Throw the recording away (Escape). */
  onCancel: () => void;
};

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
  /** Starts and stops dictation; the mic shows only when given. */
  onDictate?: () => void;
  dictation?: DictationView;
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
  dictation,
  attachments,
  canSend,
}: ComposerProps) {
  const recording = dictation?.state === "recording";
  const transcribing = dictation?.state === "transcribing";
  const attach = onAttach && (
    <IconButton label="Add photos or files" tone={large ? "outline" : "soft"} onClick={onAttach} className="size-9">
      <PlusIcon size={18} />
    </IconButton>
  );
  const send = (
    <div className="flex shrink-0 items-center gap-1">
      {recording && <RecordingMeter seconds={dictation.seconds} level={dictation.level} />}
      {onDictate && (
        <button
          type="button"
          onClick={onDictate}
          disabled={transcribing}
          aria-label={recording ? "Stop dictation" : transcribing ? "Transcribing" : "Dictate"}
          aria-pressed={recording}
          className={`relative flex size-10 items-center justify-center rounded-full transition-colors ${
            recording ? "bg-rausch text-white" : "hover:bg-surface-strong disabled:cursor-wait"
          }`}
        >
          {recording && (
            // A halo that breathes with the voice.
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-rausch/25 transition-transform duration-100 motion-reduce:hidden"
              style={{ transform: `scale(${1 + dictation.level * 0.6})` }}
            />
          )}
          {recording ? (
            <StopIcon size={16} className="relative" />
          ) : transcribing ? (
            <span className="size-[18px] animate-spin rounded-full border-2 border-hairline border-t-ink" />
          ) : (
            <MicIcon size={19} />
          )}
        </button>
      )}
      {busy ? (
        <IconButton label="Stop" tone="ink" onClick={onStop} className="size-10">
          <StopIcon size={18} />
        </IconButton>
      ) : (
        <IconButton
          label="Send"
          tone="rausch"
          type="submit"
          disabled={recording || transcribing || !(canSend ?? value.trim())}
          className="size-10"
        >
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
          if (recording && (e.key === "Escape" || e.key === "Enter")) {
            e.preventDefault();
            if (e.key === "Escape") dictation.onCancel();
            else onDictate?.(); // Enter stops and transcribes
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={large ? 2 : 1}
        autoFocus={autoFocus}
        placeholder={
          recording ? "Listening…" : transcribing ? "Writing down what you said…" : (placeholder ?? "Where and when do you need a place?")
        }
        className={`field-sizing-content w-full resize-none bg-transparent text-ink outline-none placeholder:text-muted focus-visible:outline-none ${
          large ? "max-h-60 min-h-[52px] px-1 text-[17px] leading-[26px]" : "max-h-48 min-h-10 flex-1 px-2 py-2 text-base leading-6"
        }`}
      />
      {dictation?.error && (
        <p role="alert" className={`text-[13px] text-error ${large ? "order-last mt-2 px-1" : "w-full basis-full px-3 pb-1"}`}>
          {dictation.error}
        </p>
      )}
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

/** Recording time and a five-bar level meter, next to the mic while it listens. */
function RecordingMeter({ seconds, level }: { seconds: number; level: number }) {
  const time = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return (
    <span className="flex items-center gap-2 pr-1 text-[13px] font-semibold tabular-nums text-rausch-deep" aria-live="off">
      <span className="flex h-4 items-center gap-[3px]" aria-hidden="true">
        {[0.55, 0.85, 1, 0.8, 0.5].map((w, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-rausch transition-[height] duration-100"
            style={{ height: `${Math.max(3, Math.min(16, 3 + level * 16 * w))}px` }}
          />
        ))}
      </span>
      {time}
    </span>
  );
}
