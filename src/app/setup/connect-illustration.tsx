import type { CSSProperties } from "react";
import { Couchbot } from "@/components/brand/logo";
import { CONNECTABLE_AGENTS, type ConnectableAgent } from "@/lib/connect-agent";
import "./connect-illustration.css";

const TILE = "flex size-20 shrink-0 items-center justify-center rounded-[24px] bg-canvas shadow-float sm:size-24";

/** The agent's app icon (or all four, for the generic page) linked to Couchbot by a pulsing dotted line. */
export function ConnectIllustration({ agent }: { agent: ConnectableAgent | undefined }) {
  return (
    <div aria-hidden="true" className="setup-connect-scene flex items-center justify-center gap-3 sm:gap-5">
      <div className={`setup-connect-tile setup-connect-agent ${TILE}`}>
        {agent ? (
          // eslint-disable-next-line @next/next/no-img-element -- small static app icon
          <img src={agent.icon} alt="" width={96} height={96} className="size-full rounded-[24px] object-cover" />
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
            {CONNECTABLE_AGENTS.map((a) => (
              // eslint-disable-next-line @next/next/no-img-element -- small static app icon
              <img key={a.id} src={a.icon} alt="" width={36} height={36} className="size-7 rounded-[8px] sm:size-8" />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2.5 sm:gap-3.5">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="setup-connect-dot" style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
      <div className={`setup-connect-tile setup-connect-agentbnb ${TILE}`}>
        <Couchbot size={72} animated className="sm:size-[84px]" />
      </div>
    </div>
  );
}
