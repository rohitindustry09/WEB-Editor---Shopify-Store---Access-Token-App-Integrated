"use client";

import { useEffect, useState } from "react";
import { Popover, ColorPicker, TextField, BlockStack, Text } from "@shopify/polaris";
import { hexToRgb, rgbToHsb, hsbToHex, type HSBAColor } from "@shopify/polaris";

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

function hexToHsba(hex: string): HSBAColor {
  try {
    return { ...rgbToHsb(hexToRgb(hex)), alpha: 1 };
  } catch {
    return { hue: 0, saturation: 0, brightness: 0, alpha: 1 };
  }
}

type Props = {
  /** Shown above the popover's picker — what this swatch controls, e.g. "Replace this". */
  label: string;
  value: string;
  onChange: (hex: string) => void;
};

/**
 * A real Shopify-style color picker: a clickable swatch that opens a
 * popover with the same saturation/hue picker used across Shopify admin
 * (Polaris's own `ColorPicker`), plus a hex field for typing an exact
 * value — instead of the browser's own native `<input type="color">`,
 * which looks and behaves differently on every OS/browser.
 */
export function ColorSwatchPicker({ label, value, onChange }: Props) {
  const [active, setActive] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);

  // Keeps the hex field in sync when `value` changes from outside this
  // popover — e.g. the eyedropper setting a new source color while this
  // picker is closed.
  useEffect(() => {
    const timer = setTimeout(() => setHexDraft(value), 0);
    return () => clearTimeout(timer);
  }, [value]);

  const handlePickerChange = (color: HSBAColor) => {
    onChange(hsbToHex(color));
  };

  const handleHexChange = (next: string) => {
    const normalized = next.startsWith("#") ? next : `#${next}`;
    setHexDraft(normalized);
    if (HEX_PATTERN.test(normalized)) onChange(normalized);
  };

  return (
    <Popover
      active={active}
      onClose={() => setActive(false)}
      preferredAlignment="left"
      activator={
        <button
          type="button"
          onClick={() => setActive((prev) => !prev)}
          aria-label={label}
          style={{
            width: 32,
            height: 32,
            padding: 0,
            borderRadius: 6,
            border: "1px solid var(--p-color-border)",
            background: HEX_PATTERN.test(value) ? value : "#000000",
            cursor: "pointer",
          }}
        />
      }
    >
      <div style={{ padding: 16, width: 232 }}>
        <BlockStack gap="300">
          <Text as="span" variant="bodySm" fontWeight="medium">{label}</Text>
          <ColorPicker color={hexToHsba(value)} onChange={handlePickerChange} />
          <TextField
            label="Hex"
            labelHidden
            value={hexDraft}
            onChange={handleHexChange}
            autoComplete="off"
            error={HEX_PATTERN.test(hexDraft) ? undefined : "Enter a 6-digit hex color"}
          />
        </BlockStack>
      </div>
    </Popover>
  );
}
