"use client";

import { Badge, BlockStack, Box, Button, ChoiceList, InlineStack, ProgressBar, Text } from "@shopify/polaris";
import { StoreIcon } from "@shopify/polaris-icons";
import type { MetafieldDefinitionSummary } from "@/lib/shopify/metafields";
import { SearchableSelect, type PickerOption } from "../../tools/upload-products/SearchableSelect";
import type { StoreReadProgress } from "../../tools/upload-products/readStoreSkus";

export const SOURCE_VARIANT = "variant";
export const SOURCE_METAFIELD = "metafield";

export function SkuFieldPanel({
  storeName,
  sourceKind,
  onSourceKindChange,
  definitions,
  definitionsLoading,
  metafieldId,
  onMetafieldChange,
  disabled,
  readProgress,
  cachedValueCount,
  onReload,
}: {
  storeName: string;
  sourceKind: string;
  onSourceKindChange: (value: string) => void;
  definitions: MetafieldDefinitionSummary[] | null;
  definitionsLoading: boolean;
  metafieldId: string;
  onMetafieldChange: (id: string) => void;
  disabled: boolean;
  /** Set only while the store's metafield values are being read for a scan. */
  readProgress: StoreReadProgress | null;
  /** How many SKU values are already loaded for the current metafield (0 = none yet). */
  cachedValueCount: number;
  onReload: () => void;
}) {
  // Metafields that look like a SKU go first so the likely choice is at the top of the list.
  const options: PickerOption[] = [...(definitions ?? [])]
    .sort((a, b) => Number(/sku/i.test(b.key + b.name)) - Number(/sku/i.test(a.key + a.name)))
    .map((d) => ({ value: d.id, label: d.name, helpText: `${d.namespace}.${d.key} · ${d.typeName}` }));

  const percent = readProgress?.total ? Math.min(100, (readProgress.read / readProgress.total) * 100) : 0;

  return (
    <Box padding="400" background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300">
      <BlockStack gap="300">
        <InlineStack>
          <Badge tone="success" icon={StoreIcon}>{`${storeName || "Connected store"} · SKU field`}</Badge>
        </InlineStack>
        <ChoiceList
          title="Match the zip's SKU folders to products by"
          selected={[sourceKind]}
          onChange={(selected) => onSourceKindChange(selected[0] ?? SOURCE_VARIANT)}
          disabled={disabled}
          choices={[
            { label: "Variant SKU (default)", value: SOURCE_VARIANT, helpText: "Shopify's standard SKU on each variant — same as the original Media uploader." },
            { label: "A product metafield", value: SOURCE_METAFIELD, helpText: "Use a custom metafield that holds the SKU instead." },
          ]}
        />
        {sourceKind === SOURCE_METAFIELD && (
          <BlockStack gap="200">
            <SearchableSelect
              label="Metafield that holds the SKU"
              options={options}
              value={metafieldId}
              onChange={onMetafieldChange}
              placeholder="Search the store's metafields"
              loading={definitionsLoading}
              disabled={disabled || definitionsLoading}
              helpText={
                definitions && definitions.length === 0
                  ? "This store has no product metafield definitions."
                  : "Products whose metafield is empty are ignored."
              }
            />
            {readProgress && (
              <BlockStack gap="100">
                {readProgress.total ? <ProgressBar progress={percent} size="small" tone="primary" /> : null}
                <Text as="p" variant="bodySm" tone="subdued">
                  {readProgress.total
                    ? `Reading the store — ${readProgress.read.toLocaleString()} of ${readProgress.total.toLocaleString()} products`
                    : `Reading the store — ${readProgress.read.toLocaleString()} products so far…`}
                </Text>
              </BlockStack>
            )}
            {!readProgress && cachedValueCount > 0 && (
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">{`${cachedValueCount.toLocaleString()} SKU values loaded from the store`}</Text>
                <Button variant="plain" onClick={onReload} disabled={disabled}>Reload</Button>
              </InlineStack>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Box>
  );
}
