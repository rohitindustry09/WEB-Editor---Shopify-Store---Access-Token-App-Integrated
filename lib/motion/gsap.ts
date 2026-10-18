import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

/**
 * One place that registers GSAP's plugins, so every component imports GSAP from here and
 * the plugins are registered exactly once. Only used from client components.
 */
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

export { gsap, ScrollTrigger, useGSAP };

/** Motion only runs for visitors who have not asked their device to reduce it. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

/** Mouse-like pointers only — hover effects (magnet, tilt) make no sense on touch. */
export const FINE_POINTER = "(hover: hover) and (pointer: fine)";
