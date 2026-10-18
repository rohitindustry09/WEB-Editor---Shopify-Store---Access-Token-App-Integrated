"use client";

import { useEffect, useMemo, useState } from "react";
import { Autocomplete } from "@shopify/polaris";

interface SuggestFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fetchSuggestions: (query: string) => Promise<string[]>;
  placeholder?: string;
}

export function SuggestField({ label, value, onChange, fetchSuggestions, placeholder }: SuggestFieldProps) {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      const results = await fetchSuggestions(value);
      if (!cancelled) setOptions(results);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const optionList = useMemo(() => options.map((o) => ({ value: o, label: o })), [options]);

  return (
    <Autocomplete
      options={optionList}
      selected={value ? [value] : []}
      onSelect={(selected) => onChange(selected[0] ?? "")}
      textField={
        <Autocomplete.TextField
          label={label}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete="off"
        />
      }
    />
  );
}
