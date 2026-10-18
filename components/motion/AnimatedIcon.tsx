"use client";

import type { CSSProperties } from "react";
import { Icon, type IconProps } from "@shopify/polaris";

export type IconMotion = "pop" | "wiggle" | "spin" | "pulse" | "float" | "nudge";
export type IconTrigger = "hover" | "always" | "mount";

/**
 * An icon with a built-in motion. The artwork is Shopify's Polaris icon set (MIT-licensed,
 * already part of this project — free to use commercially, no attribution needed); the
 * motion is plain CSS in `ui.css`, so there is no extra library and nothing to download.
 *
 * - `hover`: plays when the icon, or the card / button / row it sits in (`.has-icon-motion`), is hovered or focused
 * - `always`: loops quietly (a pulse for "live", a float for a hero)
 * - `mount`: plays once when it appears
 * Motion is switched off for visitors who ask for reduced motion.
 */
export function AnimatedIcon({
  source,
  motion = "pop",
  trigger = "hover",
  size = 20,
  delayMs = 0,
}: {
  source: IconProps["source"];
  motion?: IconMotion;
  trigger?: IconTrigger;
  /** Rendered size in px. */
  size?: number;
  /** Delay before the motion starts — staggers a row of icons. */
  delayMs?: number;
}) {
  const style: CSSProperties & Record<"--icon-size" | "--icon-delay", string> = {
    "--icon-size": `${size}px`,
    "--icon-delay": `${delayMs}ms`,
  };
  return (
    <span className="anim-icon" data-motion={motion} data-trigger={trigger} style={style} aria-hidden="true">
      <Icon source={source} tone="inherit" />
    </span>
  );
}
