"use client";

import { useRef, useState } from "react";
import { Autocomplete, BlockStack, Icon, Text } from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";

const NONE_VALUE = "__none__";

export interface PickerOption {
  value: string;
  label: string;
  /** Smaller second line under the label, e.g. a namespace.key or a sample value. */
  helpText?: string;
}

/**
 * A searchable single-select — Polaris's `Autocomplete` wired up as a proper
 * picker: focusing shows every option, typing filters by label or help text,
 * and leaving the field without choosing snaps back to the current
 * selection. Replaces the native <select>, which can't be searched and
 * renders as an unstyled OS list for long metafield names.
 */
export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Search…",
  loading = false,
  disabled = false,
  helpText,
  noneLabel,
  labelHidden = false,
}: {
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  helpText?: string;
  /** When set, an always-present first option with this label that means "nothing chosen" (value ""), selected by default. */
  noneLabel?: string;
  /** Hide the visible label (it is still read by assistive tech) when the surrounding layout already shows it. */
  labelHidden?: boolean;
}) {
  // null = "not typing": the field shows the selected option's label.
  const [query, setQuery] = useState<string | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = options.find((o) => o.value === value);
  const text = query ?? selected?.label ?? (noneLabel && !value ? noneLabel : "");
  const needle = (query ?? "").trim().toLowerCase();
  const matching = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.helpText ?? "").toLowerCase().includes(needle))
    : options;
  const visible = noneLabel ? [{ value: NONE_VALUE, label: noneLabel }, ...matching] : matching;

  const cancelBlurReset = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  };

  return (
    <Autocomplete
      options={visible.map((o) => ({
        value: o.value,
        label: o.helpText ? (
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd">{o.label}</Text>
            <Text as="span" variant="bodySm" tone="subdued">{o.helpText}</Text>
          </BlockStack>
        ) : (
          o.label
        ),
      }))}
      selected={value ? [value] : noneLabel ? [NONE_VALUE] : []}
      onSelect={(picked) => {
        cancelBlurReset();
        onChange(picked[0] === NONE_VALUE ? "" : (picked[0] ?? ""));
        setQuery(null);
      }}
      loading={loading}
      emptyState={
        <BlockStack gap="100" inlineAlign="center">
          <Text as="p" tone="subdued">{`No matches for "${query ?? ""}"`}</Text>
        </BlockStack>
      }
      textField={
        <Autocomplete.TextField
          label={label}
          labelHidden={labelHidden}
          value={text}
          placeholder={placeholder}
          prefix={<Icon source={SearchIcon} />}
          autoComplete="off"
          disabled={disabled}
          helpText={helpText}
          clearButton={Boolean(value) && !noneLabel}
          onClearButtonClick={() => {
            onChange("");
            setQuery("");
          }}
          onChange={(v) => {
            cancelBlurReset();
            setQuery(v);
          }}
          onFocus={cancelBlurReset}
          onBlur={() => {
            // Delayed so a click on an option (which blurs the field first) still lands.
            cancelBlurReset();
            blurTimer.current = setTimeout(() => setQuery(null), 150);
          }}
        />
      }
    />
  );
}
