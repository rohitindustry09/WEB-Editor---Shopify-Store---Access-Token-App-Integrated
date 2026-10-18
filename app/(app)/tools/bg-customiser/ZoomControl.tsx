"use client";

import { InlineStack, RangeSlider, TextField } from "@shopify/polaris";

export const ZOOM_MIN = 30;
export const ZOOM_MAX = 200;
export const ZOOM_DEFAULT = 100;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

/**
 * A single zoom slider paired with its own type-a-number box — the
 * slider's "output" bubble only shows while actively dragging, so there
 * was no persistent, editable way to see or set an exact value, only a
 * rough drag. This gives both: drag for a quick adjustment, or type an
 * exact percentage directly. One value in, evenly out on every side —
 * below 100% shrinks the photo (more background margin all around), above
 * 100% enlarges it (cropped evenly at the edges).
 *
 * Extracted out of `BgCustomiserForm.tsx` so the all-in-one pipeline's own
 * background step can use the exact same control instead of a second,
 * drifting copy.
 */
export function ZoomControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <div style={{ flex: 1 }}>
        <RangeSlider
          label="Zoom"
          labelHidden
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          value={value}
          onChange={(next) => onChange(clampZoom(Array.isArray(next) ? next[0] : next))}
        />
      </div>
      <div style={{ width: 110, flexShrink: 0 }}>
        <TextField
          label="Zoom"
          labelHidden
          type="number"
          autoComplete="off"
          suffix="%"
          value={String(value)}
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          onChange={(next) => onChange(clampZoom(Number(next)))}
        />
      </div>
    </InlineStack>
  );
}
