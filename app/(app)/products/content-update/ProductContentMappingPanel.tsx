"use client";

import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  DropZone,
  Icon,
  Box,
  Divider,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { FileIcon, XCircleIcon, ArrowRightIcon } from "@shopify/polaris-icons";
import { formatFileSize } from "@/lib/csvSkuColors";
import { UPDATABLE_FIELDS, type UpdatableField } from "@/lib/csvProductContent";

const NO_COLUMN = "";

interface ProductContentMappingPanelProps {
  file: File | null;
  onDrop: (files: File[]) => void;
  onClearFile: () => void;
  parseError: string | null;
  headers: string[];
  totalDataRows: number;
  skuColumn: string;
  onSkuColumnChange: (value: string) => void;
  fieldMapping: Partial<Record<UpdatableField, string>>;
  onFieldMappingChange: (field: UpdatableField, column: string) => void;
  readyCount: number;
  skippedNoSku: number;
  skippedNoValues: number;
  onLookup: () => void;
  looking: boolean;
}

/** Upload + "connect the right file column to the right Shopify field" step — entirely local state, no Shopify calls happen here. */
export function ProductContentMappingPanel({
  file,
  onDrop,
  onClearFile,
  parseError,
  headers,
  totalDataRows,
  skuColumn,
  onSkuColumnChange,
  fieldMapping,
  onFieldMappingChange,
  readyCount,
  skippedNoSku,
  skippedNoValues,
  onLookup,
  looking,
}: ProductContentMappingPanelProps) {
  const columnOptions = [{ label: "Choose a column…", value: NO_COLUMN }, ...headers.map((h) => ({ label: h, value: h }))];
  const fieldColumnOptions = [
    { label: "Don't update this field", value: NO_COLUMN },
    ...headers.map((h) => ({ label: h, value: h })),
  ];
  const mappedFieldCount = UPDATABLE_FIELDS.filter((f) => fieldMapping[f.key]).length;
  const canLookup = Boolean(skuColumn) && mappedFieldCount > 0 && readyCount > 0;

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingSm">Upload a CSV</Text>
          <Text as="p" tone="subdued">
            Column headers can be named however your sheet already names them — the next step lets you connect
            each Shopify field to the right column, so &quot;Title&quot; in your file matching &quot;Product
            Title&quot; in Shopify (or not matching at all) doesn&apos;t matter.
          </Text>

          {parseError && (
            <Banner tone="warning" title="Couldn't read this">
              <p>{parseError}</p>
            </Banner>
          )}

          {file ? (
            <Card background="bg-surface-secondary">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={FileIcon} tone="subdued" />
                  <BlockStack gap="0">
                    <Text as="span" fontWeight="medium">{file.name}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">{formatFileSize(file.size)}</Text>
                  </BlockStack>
                </InlineStack>
                <Button icon={XCircleIcon} variant="plain" accessibilityLabel="Remove file" onClick={onClearFile} />
              </InlineStack>
            </Card>
          ) : (
            <DropZone accept=".csv,text/csv" type="file" onDrop={(_files, accepted) => accepted[0] && onDrop(accepted)}>
              <DropZone.FileUpload actionTitle="Add file" actionHint="or drop a CSV to upload" />
            </DropZone>
          )}
        </BlockStack>
      </Card>

      {headers.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingSm">Connect your columns</Text>
              <Text as="p" tone="subdued">
                Pick which column identifies each product, then which column (if any) feeds each Shopify field
                below. Fields left as &quot;Don&apos;t update this field&quot; are left untouched on the product.
              </Text>
            </BlockStack>

            <Select
              label="SKU column"
              helpText="Used to find each row's matching product in your store."
              options={columnOptions}
              value={skuColumn}
              onChange={onSkuColumnChange}
            />

            <Divider />

            <BlockStack gap="300">
              {UPDATABLE_FIELDS.map((field) => (
                <InlineStack key={field.key} gap="300" blockAlign="center" wrap={false}>
                  <Box minWidth="160px">
                    <Text as="span" fontWeight="medium">{field.label}</Text>
                  </Box>
                  <Icon source={ArrowRightIcon} tone="subdued" />
                  <div style={{ flex: 1 }}>
                    <Select
                      label={`Column for ${field.label}`}
                      labelHidden
                      options={fieldColumnOptions}
                      value={fieldMapping[field.key] ?? NO_COLUMN}
                      onChange={(value) => onFieldMappingChange(field.key, value)}
                    />
                  </div>
                </InlineStack>
              ))}
            </BlockStack>

            <Divider />

            {(skippedNoSku > 0 || skippedNoValues > 0) && (
              <Banner tone="warning" title="Some rows will be skipped">
                <BlockStack gap="100">
                  {skippedNoSku > 0 && (
                    <Text as="p">{skippedNoSku} row{skippedNoSku === 1 ? "" : "s"} had no value in the SKU column.</Text>
                  )}
                  {skippedNoValues > 0 && (
                    <Text as="p">
                      {skippedNoValues} row{skippedNoValues === 1 ? "" : "s"} had nothing in any mapped column.
                    </Text>
                  )}
                </BlockStack>
              </Banner>
            )}

            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" tone="subdued">
                {totalDataRows} row{totalDataRows === 1 ? "" : "s"} in file — {readyCount} ready to look up,
                updating {mappedFieldCount} field{mappedFieldCount === 1 ? "" : "s"}.
              </Text>
              <Button variant="primary" loading={looking} disabled={!canLookup} onClick={onLookup}>
                Look up products
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
