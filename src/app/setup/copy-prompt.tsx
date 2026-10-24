"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckIcon } from "@/components/ui/icons";
import { CONNECTABLE_AGENTS, connectPrompt } from "@/lib/connect-agent";

const noop = () => () => {};

/**
 * The one line a person pastes into their agent, with a button that copies it. The server renders it
 * with the site's URL; in the browser it uses the origin the page was opened on (a preview deploy,
 * localhost), the same way the home banner builds it.
 */
export function CopyPrompt({ agentId, prompt }: { agentId: string | undefined; prompt: string }) {
  const agent = CONNECTABLE_AGENTS.find((a) => a.id === agentId);
  const text = useSyncExternalStore(
    noop,
    () => connectPrompt(agent, window.location.origin),
    () => prompt,
  );
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2400);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    const ok = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    setState(ok ? "copied" : "failed");
  }

  return (
    <div className="mt-7 flex w-full max-w-xl flex-col items-stretch gap-3 rounded-card border border-hairline bg-canvas p-2 text-left shadow-float sm:flex-row sm:items-center sm:pl-4">
      <p className="min-w-0 flex-1 px-2 pt-1.5 text-[15px] leading-snug break-words sm:px-0 sm:pt-0">
        <span className="sr-only">Prompt: </span>
        {text}
      </p>
      <button
        type="button"
        onClick={copy}
        className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg px-6 font-medium text-white transition-colors ${
          state === "copied" ? "bg-ink" : "bg-rausch hover:bg-rausch-active active:bg-rausch-active"
        }`}
      >
        {state === "copied" ? <CheckIcon size={18} strokeWidth={2.6} /> : <CopyIcon />}
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy prompt"}
      </button>
      <p aria-live="polite" className="sr-only">
        {state === "copied" ? "Prompt copied. Paste it to your agent." : state === "failed" ? "Couldn't copy the prompt." : ""}
      </p>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5V4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  );
}
