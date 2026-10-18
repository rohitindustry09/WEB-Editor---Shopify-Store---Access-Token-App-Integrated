"use client";

import type { IconProps } from "@shopify/polaris";
import { AnimatedIcon } from "@/components/motion/AnimatedIcon";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";

export type StatTone = "neutral" | "info" | "success" | "caution" | "critical";

/**
 * The one counter tile used everywhere a page shows "how many" (scan results, upload
 * progress, filters). Always laid out the same way — icon chip and label on top, the number
 * large beneath, everything left-aligned and filling its grid cell to the same height — so rows
 * of tiles line up, whichever page they are on. With `onClick` it becomes a filter tab
 * (a real button, `aria-pressed`, ringed while `active`). The number counts up when it changes.
 */
export function StatTile({
  value,
  label,
  tone = "neutral",
  icon,
  active = false,
  onClick,
}: {
  value: number;
  label: string;
  tone?: StatTone;
  icon?: IconProps["source"];
  /** Marks the filter that is currently applied (only meaningful with `onClick`). */
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="stat-card-head">
        {icon && (
          <span className="stat-card-icon">
            <AnimatedIcon source={icon} motion="pop" size={16} />
          </span>
        )}
        <span className="stat-card-label">{label}</span>
      </span>
      <span className="stat-card-value">
        <AnimatedNumber value={value} />
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="stat-card has-icon-motion" data-tone={tone} data-active={active} aria-pressed={active} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className="stat-card has-icon-motion" data-tone={tone}>
      {content}
    </div>
  );
}
