import { useId, type ReactNode } from "react";

export type CouchbotMood = "idle" | "thinking" | "happy" | "sleepy";

const INK = "#3a0a17";

/** The face for each mood, drawn on the backrest (eyes around y 36, mouth around y 46). */
function Face({ mood }: { mood: CouchbotMood }) {
  switch (mood) {
    case "thinking":
      // looking up and to the side, mouth pursed
      return (
        <>
          <ellipse cx="42" cy="34.5" rx="4" ry="5.4" fill={INK} />
          <ellipse cx="61" cy="34.5" rx="4" ry="5.4" fill={INK} />
          <circle cx="43.6" cy="32.4" r="1.5" fill="#fff" />
          <circle cx="62.6" cy="32.4" r="1.5" fill="#fff" />
          <path d="M47.5 47H53" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
        </>
      );
    case "happy":
      // eyes squeezed into arcs, big open smile
      return (
        <>
          <path d="M36.5 37.5Q40.5 31 44.5 37.5M55.5 37.5Q59.5 31 63.5 37.5" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
          <path d="M43.5 44.5H56.5Q56.5 51.5 50 51.5Q43.5 51.5 43.5 44.5Z" fill={INK} />
          <path d="M46.5 49.2Q50 47.6 53.5 49.2Q52.5 51 50 51Q47.5 51 46.5 49.2Z" fill="#ff7c94" />
        </>
      );
    case "sleepy":
      // eyes closed, little mouth
      return (
        <>
          <path d="M36.5 35.5Q40.5 39.5 44.5 35.5M55.5 35.5Q59.5 39.5 63.5 35.5" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <ellipse cx="50" cy="46.5" rx="2.2" ry="1.8" fill={INK} />
        </>
      );
    default:
      return (
        <>
          <ellipse cx="40.5" cy="36" rx="4" ry="5.4" fill={INK} />
          <ellipse cx="59.5" cy="36" rx="4" ry="5.4" fill={INK} />
          <circle cx="42" cy="34" r="1.5" fill="#fff" />
          <circle cx="61" cy="34" r="1.5" fill="#fff" />
          <path d="M45 45.5Q50 49.5 55 45.5" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
        </>
      );
  }
}

/**
 * Couchbot, the AgentBnB mark and the agent's face: a puffy armchair, because the couch is the
 * agent. `mood` changes the expression; `animated` adds a blink (idle), a look-around (thinking),
 * drifting z's (sleepy), two hops (happy) and a slow bob, all off under reduced motion. The same drawing lives in `src/app/icon.svg`.
 */
export function Couchbot({
  size = 28,
  mood = "idle",
  animated = false,
  className = "",
}: {
  size?: number;
  mood?: CouchbotMood;
  animated?: boolean;
  className?: string;
}) {
  // gradients and filters need ids that are unique per instance on the page
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const face = `${id}f`, side = `${id}s`, puffy = `${id}p`, soft = `${id}b`;

  // each cushion is a dark extrusion plus a lit, inflated face
  const puff = (shape: ReactNode, depth = 4.5) => (
    <>
      <g transform={`translate(0 ${depth})`} fill={`url(#${side})`}>{shape}</g>
      <g fill={`url(#${face})`} filter={`url(#${puffy})`}>{shape}</g>
    </>
  );

  const motion = !animated
    ? ""
    : mood === "thinking"
      ? "motion-safe:animate-couchbot-look"
      : mood === "idle"
        ? "motion-safe:animate-couchbot-blink"
        : "";

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={face} x1="0" y1="10" x2="0" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff7c94" />
          <stop offset=".55" stopColor="#ff385c" />
          <stop offset="1" stopColor="#ee1b4c" />
        </linearGradient>
        <linearGradient id={side} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c00d40" />
          <stop offset="1" stopColor="#96062e" />
        </linearGradient>
        <filter id={puffy} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="b" />
          <feSpecularLighting in="b" surfaceScale="5" specularConstant=".75" specularExponent="16" lightingColor="#fff" result="s">
            <feDistantLight azimuth="230" elevation="52" />
          </feSpecularLighting>
          <feComposite in="s" in2="SourceAlpha" operator="in" result="s2" />
          <feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3=".55" k4="0" />
        </filter>
        <filter id={soft} x="-40%" y="-100%" width="180%" height="300%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <ellipse
        cx="50"
        cy="92"
        rx="38"
        ry="3.6"
        fill="#000"
        opacity=".2"
        filter={`url(#${soft})`}
        className={animated ? "origin-center transform-fill motion-safe:animate-couchbot-shadow" : ""}
      />
      <g
        className={
          !animated
            ? ""
            : mood === "happy"
              ? "origin-bottom transform-fill motion-safe:animate-couchbot-hop"
              : "motion-safe:animate-couchbot-bob"
        }
      >
        <rect x="17" y="80" width="5" height="9" rx="2.5" fill="#4a0f1f" />
        <rect x="78" y="80" width="5" height="9" rx="2.5" fill="#4a0f1f" />
        {puff(<rect x="21" y="20" width="58" height="40" rx="15" />)}
        <ellipse cx="33.5" cy="44" rx="4" ry="2.4" fill="#ffd0da" opacity=".6" />
        <ellipse cx="66.5" cy="44" rx="4" ry="2.4" fill="#ffd0da" opacity=".6" />
        <g className={motion ? `origin-center transform-fill ${motion}` : ""}>
          <Face mood={mood} />
        </g>
        {puff(<rect x="25" y="55" width="50" height="20" rx="7" />, 4)}
        {puff(
          <>
            <rect x="8" y="41" width="25" height="38" rx="12.5" />
            <rect x="67" y="41" width="25" height="38" rx="12.5" />
          </>,
        )}
      </g>
      {animated && mood === "sleepy" && <Snores />}
    </svg>
  );
}

/** Three z's drifting up from the backrest, one after another, while Couchbot naps. */
function Snores() {
  return (
    <g fill="none" stroke="#a30d36" strokeLinecap="round" strokeLinejoin="round" className="motion-reduce:hidden">
      {["0s", "1s", "2s"].map((delay) => (
        <g key={delay} transform="translate(72 21)">
          <path
            d="M-3.2 -3.4H3.2L-3.2 3.4H3.2"
            strokeWidth="2.4"
            className="origin-center opacity-0 transform-fill motion-safe:animate-couchbot-snore"
            style={{ animationDelay: delay }}
          />
        </g>
      ))}
    </g>
  );
}

/** The mark on its own, for the header and anywhere the logo sits. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return <Couchbot size={size} className={className} />;
}

/** The wordmark, set in Bricolage Grotesque. */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-brand font-extrabold tracking-[-0.04em] text-rausch ${className}`}>agentbnb</span>;
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <LogoMark />
      <Wordmark className="text-[22px]" />
    </span>
  );
}
