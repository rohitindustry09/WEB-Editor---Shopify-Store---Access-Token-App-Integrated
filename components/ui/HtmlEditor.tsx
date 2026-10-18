"use client";

import { useRef } from "react";
import { BlockStack, Box, Button, ButtonGroup, Text } from "@shopify/polaris";

interface HtmlEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
}

const WRAPPERS: { label: string; open: string; close: string }[] = [
  { label: "B", open: "<strong>", close: "</strong>" },
  { label: "I", open: "<em>", close: "</em>" },
  { label: "U", open: "<u>", close: "</u>" },
];

export function HtmlEditor({ label, value, onChange, name }: HtmlEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrapSelection = (open: string, close: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    const before = value.slice(0, selectionStart);
    const selected = value.slice(selectionStart, selectionEnd) || "text";
    const after = value.slice(selectionEnd);
    onChange(`${before}${open}${selected}${close}${after}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart + open.length, selectionStart + open.length + selected.length);
    });
  };

  const insertList = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart } = el;
    const before = value.slice(0, selectionStart);
    const after = value.slice(selectionStart);
    const snippet = "\n<ul>\n  <li>Item</li>\n</ul>\n";
    onChange(`${before}${snippet}${after}`);
  };

  return (
    <BlockStack gap="150">
      <Text as="span" variant="bodyMd" fontWeight="medium">{label}</Text>
      <Box borderWidth="025" borderColor="border" borderRadius="200">
        <Box padding="150" borderBlockEndWidth="025" borderColor="border">
          <ButtonGroup variant="segmented">
            {WRAPPERS.map((w) => (
              <Button key={w.label} onClick={() => wrapSelection(w.open, w.close)}>
                {w.label}
              </Button>
            ))}
            <Button onClick={insertList}>List</Button>
          </ButtonGroup>
        </Box>
        <textarea
          ref={ref}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            resize: "vertical",
            padding: "0.75rem",
            fontFamily: "inherit",
            fontSize: "0.8125rem",
            boxSizing: "border-box",
          }}
          placeholder="Describe the product. HTML tags like <strong>, <em>, and <ul> are supported."
        />
      </Box>
    </BlockStack>
  );
}
