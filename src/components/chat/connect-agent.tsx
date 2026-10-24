"use client";

import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/ui/icons";
import type { AgentTile } from "@/lib/connect-agent";

export type { AgentTile };


/**
 * "Bring your own agent": one tile per personal agent; clicking a tile copies the prompt that
 * connects that agent to AgentBnB. `getPrompt` builds the text at click time.
 */
export function ConnectAgentBanner({ agents, getPrompt }: { agents: AgentTile[]; getPrompt: (id: string) => string }) {
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy(agent: AgentTile) {
    const ok = await navigator.clipboard.writeText(getPrompt(agent.id)).then(
      () => true,
      () => false,
    );
    setCopied({ id: agent.id, ok });
  }

  const status = copied && agents.find((a) => a.id === copied.id);

  return (
    <section aria-labelledby="connect-agent-title" className="relative rounded-card border border-hairline-soft bg-surface-soft p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-1 sm:mb-5">
        <h2 id="connect-agent-title" className="text-[17px] font-semibold">
          Have a personal agent? Connect it
        </h2>
        <p className="text-[13px] leading-[18px] text-muted sm:text-sm">
          Tap yours to copy a prompt, then paste it to your agent. It signs you up and can find you a couch or host
          travelers for you.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {agents.map((agent) => {
          const state = copied?.id === agent.id ? (copied.ok ? "copied" : "failed") : "idle";
          return (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => copy(agent)}
                aria-label={`Copy the prompt for ${agent.name}`}
                className="group flex h-full w-full items-center gap-3 rounded-[12px] border border-hairline bg-canvas p-2.5 text-left transition-[box-shadow,border-color] hover:border-transparent hover:shadow-float sm:flex-col sm:items-start sm:gap-3 sm:p-3.5"
              >
                <AgentIcons agent={agent} />
                <span className="flex min-w-0 flex-1 flex-col sm:w-full">
                  <span className="truncate text-sm font-semibold sm:text-[15px]">{agent.name}</span>
                  <span className="truncate text-xs text-muted sm:text-[13px]">{agent.maker}</span>
                </span>
                <span
                  className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors max-sm:hidden ${
                    state === "copied"
                      ? "bg-success-soft text-success"
                      : state === "failed"
                        ? "bg-rausch-soft text-rausch-deep"
                        : "bg-surface-strong text-ink group-hover:bg-ink group-hover:text-white"
                  }`}
                >
                  {state === "copied" && <CheckIcon size={13} strokeWidth={2.6} />}
                  {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy prompt"}
                </span>
                {state === "copied" && <CheckIcon size={16} strokeWidth={2.6} className="shrink-0 text-success sm:hidden" />}
              </button>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {status && (copied?.ok ? `Prompt for ${status.name} copied. Paste it to your agent.` : "Couldn't copy the prompt.")}
      </p>
    </section>
  );
}

const ICON =
  "shrink-0 rounded-[11px] bg-canvas object-cover ring-1 ring-black/5 transition-transform duration-300 ease-out motion-reduce:transition-none";

/** One app icon, or for "Any agent" a fanned stack of example agents that spreads on hover (two on phones, where the tile is a row). */
function AgentIcons({ agent }: { agent: AgentTile }) {
  if (agent.icons?.length) {
    return (
      <span className="flex h-10 shrink-0 items-center sm:h-11" aria-hidden="true">
        {agent.icons.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- small static app icon
          <img
            key={src}
            src={src}
            alt=""
            width={44}
            height={44}
            style={{ zIndex: agent.icons!.length - i }}
            className={`${ICON} size-8 ring-2 ring-canvas sm:size-10 ${i > 0 ? "-ml-4 sm:-ml-2 sm:group-hover:-ml-0.5 motion-reduce:sm:group-hover:-ml-2" : ""} ${i > 1 ? "max-sm:hidden" : ""} transition-[margin,transform] group-hover:-translate-y-0.5`}
          />
        ))}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static app icon
    <img
      src={agent.icon}
      alt=""
      width={44}
      height={44}
      className={`${ICON} size-10 group-hover:-translate-y-0.5 group-hover:rotate-[-4deg] motion-reduce:group-hover:transform-none sm:size-11`}
    />
  );
}
