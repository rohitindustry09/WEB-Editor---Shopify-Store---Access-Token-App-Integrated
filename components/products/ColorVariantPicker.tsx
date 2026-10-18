"use client";

import { useMemo, useState } from "react";
import { Modal, TextField, Box, BlockStack, Checkbox, InlineStack, Text } from "@shopify/polaris";

export interface ColorLibraryEntry {
  id: string;
  name: string;
  hex: string | null;
}

interface ColorVariantPickerProps {
  open: boolean;
  onClose: () => void;
  library: ColorLibraryEntry[];
  selected: ColorLibraryEntry[];
  onChange: (selected: ColorLibraryEntry[]) => void;
}

export function ColorVariantPicker({ open, onClose, library, selected, onChange }: ColorVariantPickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return library;
    const q = query.trim().toLowerCase();
    return library.filter((c) => c.name.toLowerCase().includes(q));
  }, [library, query]);

  const selectedIds = new Set(selected.map((c) => c.id));

  const toggle = (entry: ColorLibraryEntry) => {
    if (selectedIds.has(entry.id)) {
      onChange(selected.filter((c) => c.id !== entry.id));
    } else {
      onChange([...selected, entry]);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add color" size="large">
      <Modal.Section>
        <BlockStack gap="300">
          <TextField
            label="Search colors"
            labelHidden
            autoComplete="off"
            placeholder="Search Color library…"
            value={query}
            onChange={setQuery}
            clearButton
            onClearButtonClick={() => setQuery("")}
            autoFocus
          />
          <Text as="span" tone="subdued" variant="bodySm">
            {selected.length} selected
          </Text>
          <Box maxWidth="100%" overflowX="hidden">
            <BlockStack gap="0">
              {filtered.map((entry) => (
                <label
                  key={entry.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 0.25rem",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--p-color-border)",
                  }}
                >
                  <Checkbox label="" labelHidden checked={selectedIds.has(entry.id)} onChange={() => toggle(entry)} />
                  <span
                    aria-hidden
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      flexShrink: 0,
                      background: entry.hex ?? "transparent",
                      border: "1px solid var(--p-color-border)",
                    }}
                  />
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span">{entry.name}</Text>
                    {entry.hex && <Text as="span" tone="subdued" variant="bodySm">{entry.hex}</Text>}
                  </InlineStack>
                </label>
              ))}
              {filtered.length === 0 && (
                <Text as="p" tone="subdued">No colors match &ldquo;{query}&rdquo;.</Text>
              )}
            </BlockStack>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
