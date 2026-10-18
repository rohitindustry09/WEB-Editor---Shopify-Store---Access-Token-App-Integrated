"use client";

import { useEffect, useMemo, useState } from "react";
import { Autocomplete, Tag, BlockStack, InlineStack, Text } from "@shopify/polaris";

interface TagInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  fetchSuggestions: (query: string) => Promise<string[]>;
}

export function TagInput({ label, values, onChange, fetchSuggestions }: TagInputProps) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      const results = await fetchSuggestions(input);
      if (!cancelled) setOptions(results.filter((r) => !values.includes(r)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const optionList = useMemo(
    () => options.map((o) => ({ value: o, label: o })),
    [options],
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setInput("");
  };

  return (
    <BlockStack gap="150">
      <Autocomplete
        options={optionList}
        selected={[]}
        onSelect={(selected) => addTag(selected[0])}
        textField={
          <Autocomplete.TextField
            label={label}
            value={input}
            onChange={setInput}
            placeholder="Type and press Enter to add a tag"
            autoComplete="off"
            onBlur={() => input.trim() && addTag(input)}
          />
        }
      />
      {values.length > 0 && (
        <InlineStack gap="100">
          {values.map((tag) => (
            <Tag key={tag} onRemove={() => onChange(values.filter((v) => v !== tag))}>
              {tag}
            </Tag>
          ))}
        </InlineStack>
      )}
      {values.length === 0 && <Text as="span" tone="subdued" variant="bodySm">No tags yet.</Text>}
    </BlockStack>
  );
}
