"use client";

import { useState } from "react";
import { TextField } from "@shopify/polaris";

/**
 * A number box for "how many workers run at the same time". Type any whole number
 * from 1 to `max`: what is typed is used as soon as it is a valid number, and
 * leaving the box (or a value outside the range) snaps it to the nearest allowed one.
 */
export function WorkersField({
  value,
  onChange,
  max,
  disabled = false,
  helpText,
}: {
  value: number;
  onChange: (workers: number) => void;
  max: number;
  disabled?: boolean;
  helpText?: string;
}) {
  // null = not typing: the box shows the current value; while typing it shows exactly what was typed, even an empty box.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <TextField
      label="Workers"
      labelHidden
      prefix="Workers"
      type="number"
      min={1}
      max={max}
      step={1}
      inputMode="numeric"
      autoComplete="off"
      value={draft ?? String(value)}
      disabled={disabled}
      helpText={helpText}
      onChange={(text) => {
        setDraft(text);
        const typed = Number.parseInt(text, 10);
        if (Number.isFinite(typed) && typed >= 1) onChange(Math.min(max, typed));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
