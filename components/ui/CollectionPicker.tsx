"use client";

import { BlockStack, Checkbox, Text } from "@shopify/polaris";

interface CollectionOption {
  id: string;
  title: string;
}

interface CollectionPickerProps {
  label: string;
  options: CollectionOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function CollectionPicker({ label, options, selected, onChange }: CollectionPickerProps) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  return (
    <BlockStack gap="150">
      <Text as="span" variant="bodyMd" fontWeight="medium">{label}</Text>
      {options.length === 0 ? (
        <Text as="span" tone="subdued" variant="bodySm">No collections yet.</Text>
      ) : (
        <BlockStack gap="100">
          {options.map((c) => (
            <Checkbox
              key={c.id}
              label={c.title}
              checked={selected.includes(c.id)}
              onChange={() => toggle(c.id)}
            />
          ))}
        </BlockStack>
      )}
    </BlockStack>
  );
}
