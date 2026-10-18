"use client";

import { Badge, BlockStack, Box, Button, ButtonGroup, DropZone, InlineStack, Text, Thumbnail } from "@shopify/polaris";
import { FileIcon, ListBulletedIcon } from "@shopify/polaris-icons";
import type { CsvFilterMode, FolderSplit } from "@/lib/skuCsvFilter";

export interface LoadedCsv {
  name: string;
  /** Every SKU in the file's first column, in order (duplicates kept for the count). */
  skus: string[];
}

export function CsvFilterPanel({
  csv,
  mode,
  onModeChange,
  onFile,
  onClear,
  error,
  split,
  folderCount,
  disabled,
}: {
  csv: LoadedCsv | null;
  mode: CsvFilterMode;
  onModeChange: (mode: CsvFilterMode) => void;
  onFile: (file: File) => void;
  onClear: () => void;
  error: string | null;
  /** The live include/exclude result for the loaded zip — null until a zip is loaded. */
  split: FolderSplit | null;
  folderCount: number;
  disabled: boolean;
}) {
  const uniqueCount = csv ? new Set(csv.skus.map((s) => s.trim().toLowerCase())).size : 0;

  return (
    <Box padding="400" background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300">
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="info" icon={ListBulletedIcon}>SKU filter (optional)</Badge>
        </InlineStack>

        <BlockStack gap="100">
          <Text as="p" variant="headingSm">What should the CSV do?</Text>
          <ButtonGroup variant="segmented">
            <Button pressed={mode === "include"} onClick={() => onModeChange("include")} disabled={disabled}>
              Only upload these SKUs
            </Button>
            <Button pressed={mode === "exclude"} onClick={() => onModeChange("exclude")} disabled={disabled}>
              Don&apos;t upload these SKUs
            </Button>
          </ButtonGroup>
          <Text as="p" variant="bodySm" tone="subdued">
            {mode === "include"
              ? "Only the SKU folders listed in your CSV are uploaded."
              : "Every SKU folder is uploaded except the ones listed in your CSV."}
          </Text>
        </BlockStack>

        {csv ? (
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                <Thumbnail source={FileIcon} size="small" alt="" />
                <BlockStack gap="050">
                  <Text as="span" fontWeight="semibold">{csv.name}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`${csv.skus.length.toLocaleString()} SKU${csv.skus.length === 1 ? "" : "s"}${uniqueCount !== csv.skus.length ? ` (${uniqueCount.toLocaleString()} unique)` : ""}`}
                  </Text>
                </BlockStack>
              </InlineStack>
              <Button variant="tertiary" tone="critical" onClick={onClear} disabled={disabled}>Remove</Button>
            </InlineStack>

            {split ? (
              <InlineStack gap="200">
                <Badge tone="success">{`${split.eligible.length.toLocaleString()} of ${folderCount.toLocaleString()} folders will be scanned`}</Badge>
                <Badge tone={split.skipped.length > 0 ? "attention" : undefined}>{`${split.skipped.length.toLocaleString()} left out by the CSV`}</Badge>
                <Badge tone={split.csvWithoutFolder > 0 ? "warning" : undefined}>{`${split.csvWithoutFolder.toLocaleString()} CSV SKUs have no folder in the zip`}</Badge>
              </InlineStack>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">Add the zip below to see how many folders this keeps.</Text>
            )}
          </BlockStack>
        ) : (
          <BlockStack gap="200">
            <DropZone accept=".csv,text/csv" type="file" disabled={disabled} onDrop={(_files, accepted) => accepted[0] && onFile(accepted[0])}>
              <DropZone.FileUpload actionTitle="Add CSV" actionHint="one column of SKUs — optional" />
            </DropZone>
            <Text as="p" variant="bodySm" tone="subdued">
              Skip this to upload every SKU folder in the zip. With a CSV you choose whether to upload only its SKUs or everything except them.
            </Text>
          </BlockStack>
        )}

        {error && <Text as="p" variant="bodySm" tone="critical">{error}</Text>}
      </BlockStack>
    </Box>
  );
}
