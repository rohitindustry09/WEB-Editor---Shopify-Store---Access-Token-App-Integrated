"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { IconProps } from "@shopify/polaris";
import { ArrowRightIcon } from "@shopify/polaris-icons";
import { AnimatedIcon } from "@/components/motion/AnimatedIcon";

/** Soft colour sets for a tile's icon chip and hover glow — shared by every launcher grid. */
export const TILE_COLORS = {
  brass: { tint: "rgba(184,134,43,0.15)", ink: "#8a6414", inkDark: "#e9c46a", glow: "rgba(184,134,43,0.28)" },
  violet: { tint: "rgba(124,58,237,0.13)", ink: "#6d28d9", inkDark: "#c4b5fd", glow: "rgba(124,58,237,0.26)" },
  sky: { tint: "rgba(14,165,233,0.13)", ink: "#0369a1", inkDark: "#7dd3fc", glow: "rgba(14,165,233,0.26)" },
  emerald: { tint: "rgba(16,185,129,0.13)", ink: "#047857", inkDark: "#6ee7b7", glow: "rgba(16,185,129,0.26)" },
  rose: { tint: "rgba(244,63,94,0.12)", ink: "#be123c", inkDark: "#fda4af", glow: "rgba(244,63,94,0.24)" },
  amber: { tint: "rgba(245,158,11,0.14)", ink: "#b45309", inkDark: "#fcd34d", glow: "rgba(245,158,11,0.26)" },
} as const;

export type TileColor = keyof typeof TILE_COLORS;

/**
 * A link card for hub pages and launchers: an icon chip, a title and a short description, all
 * left-aligned, with an arrow that slides in on hover. (A plain Polaris Icon inside a stack
 * centres itself, which is what made these cards look misaligned.)
 */
export function LinkTile({
  href,
  title,
  text,
  icon,
  color = "brass",
  className = "",
  delayMs = 0,
}: {
  href: string;
  title: string;
  text: string;
  icon: IconProps["source"];
  color?: TileColor;
  className?: string;
  /** Staggers a grid of tiles as they reveal. */
  delayMs?: number;
}) {
  const c = TILE_COLORS[color];
  return (
    <Link
      href={href}
      className={`bento-tile has-icon-motion reveal ${className}`.trim()}
      style={
        {
          "--tile-tint": c.tint,
          "--tile-ink": c.ink,
          "--tile-ink-dark": c.inkDark,
          "--tile-glow": c.glow,
          animationDelay: `${delayMs}ms`,
        } as CSSProperties
      }
    >
      <span className="bento-icon">
        <AnimatedIcon source={icon} motion="wiggle" size={20} />
      </span>
      <span className="bento-title">{title}</span>
      <span className="bento-text">{text}</span>
      <span className="bento-go">
        <AnimatedIcon source={ArrowRightIcon} motion="nudge" size={16} />
      </span>
    </Link>
  );
}
