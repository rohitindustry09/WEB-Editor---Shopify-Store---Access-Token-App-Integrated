"use client";

import { BlockStack, InlineStack, Text } from "@shopify/polaris";
import type { ExistingColorValue } from "@/lib/shopify/productOptions";

/** Shows a product's existing "Color" option values as swatch pills, matching Shopify admin's own style. */
export function ColorOptionBadges({ values }: { values: ExistingColorValue[] }) {
  if (values.length === 0) return null;

  return (
    <BlockStack gap="100">
      <Text as="span" tone="subdued" variant="bodySm">Color</Text>
      <InlineStack gap="150" wrap>
        {values.map((v) => (
          <span
            key={v.name}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.25rem 0.6rem 0.25rem 0.4rem",
              borderRadius: "999px",
              background: "var(--p-color-bg-surface-info, #EBF0FA)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                flexShrink: 0,
                background: v.hex ?? "transparent",
                border: "1px solid rgba(0, 0, 0, 0.15)",
              }}
            />
            <Text as="span" variant="bodySm">{v.name}</Text>
          </span>
        ))}
      </InlineStack>
    </BlockStack>
  );
}
