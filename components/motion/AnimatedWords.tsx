"use client";

import { useRef, type ElementType } from "react";
import { gsap, useGSAP, MOTION_OK } from "@/lib/motion/gsap";

/**
 * A headline whose words rise out of a mask one after another (the split-text reveal seen on
 * most GSAP showcase sites). The words are rendered by React as separate spans, so React
 * still owns every node — nothing rewrites the DOM behind its back — and the full sentence is
 * exposed once to screen readers instead of word by word.
 */
export function AnimatedWords({
  text,
  as: Tag = "span",
  delay = 0,
  className,
}: {
  text: string;
  as?: ElementType;
  delay?: number;
  className?: string;
}) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(".word-inner", {
          yPercent: 115,
          rotate: 4,
          duration: 0.9,
          ease: "power4.out",
          stagger: 0.07,
          delay,
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <Tag ref={root} className={className} aria-label={text}>
      {text.split(" ").map((word, index) => (
        <span key={`${word}-${index}`} className="word" aria-hidden="true">
          <span className="word-inner">{word}</span>
          {" "}
        </span>
      ))}
    </Tag>
  );
}
