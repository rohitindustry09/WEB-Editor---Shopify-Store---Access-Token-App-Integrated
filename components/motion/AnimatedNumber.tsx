"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "@/lib/motion/gsap";

const DEFAULT_DURATION_S = 0.7;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A number that counts up (or down) to its new value instead of jumping — used on live
 * counters so progress feels continuous. The count is a GSAP tween (power3.out, so it
 * decelerates into the final value); visitors who ask for reduced motion get the final value
 * straight away, and the server renders the plain value so there is no hydration mismatch.
 */
export function AnimatedNumber({
  value,
  format = (n) => n.toLocaleString(),
  durationMs = DEFAULT_DURATION_S * 1000,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  const counter = useRef({ n: value });

  useEffect(() => {
    const tween = gsap.to(counter.current, {
      n: value,
      duration: prefersReducedMotion() ? 0 : durationMs / 1000,
      ease: "power3.out",
      overwrite: true,
      onUpdate: () => setShown(counter.current.n),
    });
    return () => {
      tween.kill();
    };
  }, [value, durationMs]);

  return <span className="tabular">{format(Math.round(shown))}</span>;
}
