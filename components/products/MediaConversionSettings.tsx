"use client";

import { Card, BlockStack, InlineStack, InlineGrid, Text, RangeSlider, Checkbox, TextField, Button, Banner } from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { LinkIcon } from "@shopify/polaris-icons";
import type { ImageFormat } from "@/lib/imageProcessing";
import { formatFileSize } from "@/lib/csvSkuColors";

export type MaxSizeOption = "none" | "100" | "150" | "200" | "custom";
export type ReplaceMode = "none" | "lastUpload" | "all";

export interface ConversionUiState {
  format: ImageFormat;
  quality: number; // 1–100
  maxSizeOption: MaxSizeOption;
  customMaxSizeKb: number;
  resizeOverMegapixels: boolean;
  replaceMode: ReplaceMode;
  customResizeEnabled: boolean;
  customWidth: number;
  customHeight: number;
  /** Whether editing one of width/height proportionally scales the other. */
  customResizeLinked: boolean;
  /** `{name}`, `{folder}`, `{index}`, `{ext}` — blank keeps the original filename (with whatever extension the chosen format produces). */
  renamePattern: string;
}

export const DEFAULT_CONVERSION_STATE: ConversionUiState = {
  format: "original",
  quality: 80,
  maxSizeOption: "none",
  customMaxSizeKb: 200,
  resizeOverMegapixels: true,
  replaceMode: "none",
  customResizeEnabled: false,
  customWidth: 128,
  customHeight: 128,
  customResizeLinked: true,
  renamePattern: "",
};

export const FORMAT_OPTIONS = [
  { label: "Keep original format", value: "original" },
  { label: "Auto (PNG if transparent, else WebP)", value: "auto" },
  { label: "WebP", value: "image/webp" },
  { label: "JPG (.jpg)", value: "image/jpg" },
  { label: "JPEG (.jpeg)", value: "image/jpeg" },
  { label: "PNG", value: "image/png" },
];

const MAX_SIZE_OPTIONS = [
  { label: "No limit", value: "none" },
  { label: "Up to 100 KB each", value: "100" },
  { label: "Up to 150 KB each", value: "150" },
  { label: "Up to 200 KB each", value: "200" },
  { label: "Custom…", value: "custom" },
];

const REPLACE_MODE_OPTIONS = [
  { label: "Add to existing images", value: "none" },
  { label: "Replace only images from my last upload", value: "lastUpload" },
  { label: "Replace all existing images", value: "all" },
];

const REPLACE_MODE_HELP: Record<ReplaceMode, string> = {
  none: "Nothing gets removed — new images are added alongside whatever the product already has.",
  lastUpload: "Deletes only the images this tool uploaded last time (tracked in your browser), then adds the new set. Anything else on the product is left alone.",
  all: "Deletes every image currently on the product — including ones you didn't upload with this tool — before adding the new set.",
};

interface Props {
  value: ConversionUiState;
  onChange: (next: ConversionUiState) => void;
  /** Omit to hide the "Preview conversion" row entirely (tools with no preview step). */
  onPreview?: () => void;
  previewing?: boolean;
  previewSummary?: { originalTotal: number; estimatedTotal: number; count: number } | null;
  /** Off for tools that don't touch a Shopify product — nothing to "replace". */
  showReplaceMode?: boolean;
  /** Heading / blurb overrides for tools that aren't uploading to Shopify. */
  title?: string;
  description?: string;
  /** Hide this panel's own "Output format" dropdown when the host renders the format choice itself. */
  hideFormat?: boolean;
}

export function MediaConversionSettings({
  value,
  onChange,
  onPreview,
  previewing = false,
  previewSummary = null,
  showReplaceMode = true,
  title = "Convert before uploading",
  description = "Every image is converted to these settings right before it's uploaded to Shopify. Preview first to see the expected total size.",
  hideFormat = false,
}: Props) {
  const qualityLocked = value.format === "image/png";

  const handleWidthChange = (raw: string) => {
    const width = Math.max(1, Math.round(Number(raw) || 0));
    if (value.customResizeLinked && value.customWidth > 0) {
      const ratio = value.customHeight / value.customWidth;
      onChange({ ...value, customWidth: width, customHeight: Math.max(1, Math.round(width * ratio)) });
    } else {
      onChange({ ...value, customWidth: width });
    }
  };

  const handleHeightChange = (raw: string) => {
    const height = Math.max(1, Math.round(Number(raw) || 0));
    if (value.customResizeLinked && value.customHeight > 0) {
      const ratio = value.customWidth / value.customHeight;
      onChange({ ...value, customHeight: height, customWidth: Math.max(1, Math.round(height * ratio)) });
    } else {
      onChange({ ...value, customHeight: height });
    }
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingSm">{title}</Text>
        <Text as="p" tone="subdued">{description}</Text>

        <InlineGrid columns={{ xs: 1, sm: hideFormat ? 1 : 2 }} gap="400">
          {!hideFormat && (
            <Select
              label="Output format"
              options={FORMAT_OPTIONS}
              value={value.format}
              onChange={(v) => onChange({ ...value, format: v as ImageFormat })}
            />
          )}
          <Select
            label="Max size per image"
            options={MAX_SIZE_OPTIONS}
            value={value.maxSizeOption}
            onChange={(v) => onChange({ ...value, maxSizeOption: v as MaxSizeOption })}
          />
        </InlineGrid>

        {value.maxSizeOption === "custom" && (
          <TextField
            label="Custom max size (KB)"
            type="number"
            autoComplete="off"
            value={String(value.customMaxSizeKb)}
            onChange={(v) => onChange({ ...value, customMaxSizeKb: Math.max(10, Number(v) || 0) })}
          />
        )}

        <TextField
          label="Rename pattern (optional)"
          autoComplete="off"
          value={value.renamePattern}
          onChange={(v) => onChange({ ...value, renamePattern: v })}
          placeholder="{name}-{index}.{ext}"
          helpText="Leave blank to keep each file's original name. Variables: {name} (original filename), {folder} (its parent folder, e.g. a SKU), {index} (1-based position in the batch), {ext} (the output extension)."
        />

        <RangeSlider
          label={`Quality: ${value.quality}%`}
          min={35}
          max={100}
          value={value.quality}
          onChange={(v) => onChange({ ...value, quality: Array.isArray(v) ? v[0] : v })}
          disabled={qualityLocked}
          helpText={qualityLocked ? "PNG is lossless — quality doesn't apply." : "Higher quality means a larger file."}
        />

        <Checkbox
          label="Automatically resize images over 25 megapixels"
          checked={value.resizeOverMegapixels}
          onChange={(checked) => onChange({ ...value, resizeOverMegapixels: checked })}
        />

        <BlockStack gap="200">
          <Checkbox
            label="Custom resize"
            checked={value.customResizeEnabled}
            onChange={(checked) => onChange({ ...value, customResizeEnabled: checked })}
          />
          {value.customResizeEnabled && (
            <InlineStack gap="200" blockAlign="end" wrap={false}>
              <TextField
                label="Width (px)"
                type="number"
                autoComplete="off"
                min={1}
                value={String(value.customWidth)}
                onChange={handleWidthChange}
              />
              <div style={{ paddingBottom: "0.4rem" }}>
                <Button
                  icon={LinkIcon}
                  pressed={value.customResizeLinked}
                  accessibilityLabel={value.customResizeLinked ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  onClick={() => onChange({ ...value, customResizeLinked: !value.customResizeLinked })}
                />
              </div>
              <TextField
                label="Height (px)"
                type="number"
                autoComplete="off"
                min={1}
                value={String(value.customHeight)}
                onChange={handleHeightChange}
              />
            </InlineStack>
          )}
        </BlockStack>

        {showReplaceMode && (
          <Select
            label="Existing images on the product"
            options={REPLACE_MODE_OPTIONS}
            value={value.replaceMode}
            onChange={(v) => onChange({ ...value, replaceMode: v as ReplaceMode })}
            helpText={REPLACE_MODE_HELP[value.replaceMode]}
          />
        )}

        {onPreview && (
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" tone="subdued" variant="bodySm">
              {previewSummary
                ? `${previewSummary.count} images: ${formatFileSize(previewSummary.originalTotal)} → ~${formatFileSize(previewSummary.estimatedTotal)}`
                : "Run a preview to see the expected output size."}
            </Text>
            <Button loading={previewing} onClick={onPreview}>
              Preview conversion
            </Button>
          </InlineStack>
        )}

        {previewSummary && previewSummary.estimatedTotal > previewSummary.originalTotal && (
          <Banner tone="warning">
            <p>These settings would make the images larger, not smaller — consider a lower quality or a different format.</p>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}
