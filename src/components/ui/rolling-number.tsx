"use client";

import { useState } from "react";

/**
 * A counter that rolls to its new value: the new number slides in from below when it grows and
 * from above when it shrinks. `format` turns the number into what's shown (e.g. "99+").
 */
export function RollingNumber({ value, format = String }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  if (value !== shown) {
    setDirection(value > shown ? "up" : "down");
    setShown(value);
  }
  return (
    <span className="inline-flex overflow-hidden">
      <span
        key={value}
        className={`inline-block ${direction === "up" ? "motion-safe:animate-roll-up" : direction === "down" ? "motion-safe:animate-roll-down" : ""}`}
      >
        {format(value)}
      </span>
    </span>
  );
}
