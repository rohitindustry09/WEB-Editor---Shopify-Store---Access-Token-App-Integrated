"use client";

import { Badge, BlockStack, Box, Card, Icon, InlineGrid, InlineStack, Scrollable, Text } from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";

export interface PreviewItem {
  imageUrl: string | null;
  title: string;
}

export interface ColumnRow {
  sku: string;
  left: PreviewItem | null;
  right: PreviewItem | null;
  /** Small tag shown beside the SKU, e.g. "Shared SKU". */
  flag?: string;
}

const THUMB_SIZE = 76;
const SKU_LIST_HEIGHT = "640px";

function Thumb({ sku, item }: { sku: string; item: PreviewItem }) {
  return (
    <div title={`${sku} — ${item.title}`} style={{ width: THUMB_SIZE }}>
      <Box borderWidth="025" borderColor="border" borderRadius="200" background="bg-surface-secondary" minHeight={`${THUMB_SIZE}px`}>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote store images; thousands can be on one page, so they're lazy-loaded natively
          <img
            src={item.imageUrl}
            alt={item.title}
            loading="lazy"
            width={THUMB_SIZE}
            height={THUMB_SIZE}
            style={{ display: "block", width: "100%", height: THUMB_SIZE, objectFit: "cover", borderRadius: 8 }}
          />
        ) : (
          <div style={{ height: THUMB_SIZE, display: "grid", placeItems: "center" }}>
            <Icon source={ImageIcon} tone="subdued" />
          </div>
        )}
      </Box>
      <Text as="p" variant="bodySm" tone="subdued" truncate>{sku}</Text>
    </div>
  );
}

function PreviewPanel({ title, side, rows, emptyText }: { title: string; side: "left" | "right"; rows: ColumnRow[]; emptyText: string }) {
  const shown = rows.filter((row) => (side === "left" ? row.left : row.right));
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="200">
          <Text as="h3" variant="headingSm" truncate>{title}</Text>
          <Badge>{shown.length.toLocaleString()}</Badge>
        </InlineStack>
        {shown.length === 0 ? (
          <Text as="p" tone="subdued">{emptyText}</Text>
        ) : (
          // Deliberately NOT scrollable — the whole page of previews is laid out in full.
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {shown.map((row) => {
              const item = side === "left" ? row.left : row.right;
              return item ? <Thumb key={row.sku} sku={row.sku} item={item} /> : null;
            })}
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

export function CompareColumns({
  rows,
  startIndex,
  leftName,
  rightName,
  leftEmpty,
  rightEmpty,
}: {
  rows: ColumnRow[];
  /** 0-based position of the first row on this page, so the SKU list's numbering continues across pages. */
  startIndex: number;
  leftName: string;
  rightName: string;
  leftEmpty: string;
  rightEmpty: string;
}) {
  return (
    <InlineGrid columns={{ xs: 1, md: 3 }} gap="400" alignItems="start">
      <PreviewPanel title={leftName} side="left" rows={rows} emptyText={leftEmpty} />
      <PreviewPanel title={rightName} side="right" rows={rows} emptyText={rightEmpty} />
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" gap="200">
            <Text as="h3" variant="headingSm">SKU IDs</Text>
            <Badge>{rows.length.toLocaleString()}</Badge>
          </InlineStack>
          <Scrollable shadow focusable style={{ height: SKU_LIST_HEIGHT }}>
            <BlockStack gap="150">
              {rows.map((row, index) => (
                <InlineStack key={row.sku} align="space-between" blockAlign="center" gap="200" wrap={false}>
                  <Text as="span" variant="bodySm" breakWord>
                    <Text as="span" variant="bodySm" tone="subdued">{`${(startIndex + index + 1).toLocaleString()}. `}</Text>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{row.sku}</Text>
                  </Text>
                  {row.flag && <Badge tone="attention">{row.flag}</Badge>}
                </InlineStack>
              ))}
            </BlockStack>
          </Scrollable>
        </BlockStack>
      </Card>
    </InlineGrid>
  );
}
