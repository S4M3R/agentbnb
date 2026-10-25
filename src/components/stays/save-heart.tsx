"use client";

import { useState } from "react";
import { HeartIcon } from "@/components/ui/icons";

const DOTS = [0, 60, 120, 180, 240, 300];

/** The heart on a stay's photo. Saving pops it and bursts a ring of dots out of it. */
export function SaveHeart({ title, saved, onToggle }: { title: string; saved?: boolean; onToggle: () => void }) {
  // counts saves, so each one replays the burst
  const [bursts, setBursts] = useState(0);
  const [was, setWas] = useState(saved);
  if (saved !== was) {
    if (saved) setBursts((n) => n + 1);
    setWas(saved);
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
      aria-pressed={saved}
      className="absolute right-2 top-2 flex size-10 items-center justify-center rounded-full transition-transform active:scale-90"
    >
      {saved && bursts > 0 && (
        <span key={bursts} aria-hidden="true" className="pointer-events-none absolute inset-0 motion-reduce:hidden">
          {DOTS.map((angle) => (
            <span
              key={angle}
              className="absolute left-1/2 top-1/2 -ml-[3px] -mt-[3px] size-1.5 rounded-full bg-rausch motion-safe:animate-burst"
              style={{ "--angle": `${angle}deg` } as React.CSSProperties}
            />
          ))}
        </span>
      )}
      <HeartIcon
        key={saved ? `on-${bursts}` : "off"}
        size={24}
        className={`${saved ? "fill-rausch text-white motion-safe:animate-heart-pop" : "fill-black/45 text-white"}`}
      />
    </button>
  );
}
