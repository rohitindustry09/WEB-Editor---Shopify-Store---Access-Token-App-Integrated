"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import { Box, BlockStack, InlineStack, Text, Badge, Button, Thumbnail, Spinner } from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { idFromGid } from "@/lib/format";
import type { ExistingMediaItem } from "@/lib/shopify/media";
import type { MediaSkuGroup, MediaSkuProduct } from "@/app/(app)/products/media-upload/actions";
import { MediaReorderRow, type MediaOrderItem } from "./MediaReorderRow";
import type { ImageProcessStep } from "./MediaImageGrid";
import type { ReplaceMode } from "./MediaConversionSettings";

export type RowStatus = { state: "idle" | "processing" | "uploaded" | "error"; message?: string };

const PRODUCT_STATUS_BADGE: Record<MediaSkuProduct["status"], { label: string; tone: "success" | "info" | "warning" }> = {
  ACTIVE: { label: "Active", tone: "success" },
  DRAFT: { label: "Draft", tone: "info" },
  ARCHIVED: { label: "Archived", tone: "warning" },
};

interface Props {
  group: MediaSkuGroup;
  product: MediaSkuProduct;
  status: RowStatus | undefined;
  existingList: ExistingMediaItem[] | undefined;
  lastUploadIds: string[];
  replaceMode: ReplaceMode;
  showMediaPreviews: boolean;
  uploading: boolean;
  mediaOrderOverride: MediaOrderItem[] | undefined;
  newFilenames: string[];
  newImages: { url: string; filename: string }[];
  imageStatusForSku: Record<string, ImageProcessStep>;
  onRetry: (group: MediaSkuGroup, product: MediaSkuProduct) => void;
  onRestart: (group: MediaSkuGroup, product: MediaSkuProduct) => void;
  onReorder: (productId: string, next: MediaOrderItem[]) => void;
}

function buildDefaultOrder(
  group: MediaSkuGroup,
  existingList: ExistingMediaItem[] | undefined,
  newFilenames: string[],
  newImages: { url: string; filename: string }[],
): MediaOrderItem[] {
  const existingItems: MediaOrderItem[] = (existingList ?? []).map((m) => ({
    kind: "existing",
    mediaId: m.id,
    url: m.url,
  }));
  // `newFilenames` is the authoritative list (from the zip itself); `newImages`
  // only supplies a preview URL when one's been decoded, so the count here
  // stays correct even before/without the display toggle loading anything.
  const newItems: MediaOrderItem[] = newFilenames.map((filename) => ({
    kind: "new",
    key: `${group.sku}::${filename}`,
    sku: group.sku,
    filename,
    url: newImages.find((img) => img.filename === filename)?.url ?? "",
  }));
  return [...existingItems, ...newItems];
}

/** One product's row in the media uploader — memoized so an image-status tick or drag on one product doesn't re-render every other row on the page. */
export const MediaProductRow = memo(function MediaProductRow({
  group,
  product,
  status,
  existingList,
  lastUploadIds,
  replaceMode,
  showMediaPreviews,
  uploading,
  mediaOrderOverride,
  newFilenames,
  newImages,
  imageStatusForSku,
  onRetry,
  onRestart,
  onReorder,
}: Props) {
  const orderedItems = useMemo(
    () => mediaOrderOverride ?? buildDefaultOrder(group, existingList, newFilenames, newImages),
    [mediaOrderOverride, group, existingList, newFilenames, newImages],
  );

  const newItemCount = useMemo(() => orderedItems.filter((i) => i.kind === "new").length, [orderedItems]);
  const newItemsDone = useMemo(
    () => orderedItems.filter((i) => i.kind === "new" && imageStatusForSku[i.filename] === "done").length,
    [orderedItems, imageStatusForSku],
  );

  return (
    <Box padding="300" borderBlockEndWidth="025" borderColor="border">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="300" blockAlign="center">
            <Thumbnail source={product.imageUrl ?? ImageIcon} alt={product.title} size="small" />
            <BlockStack gap="050">
              <InlineStack gap="150" blockAlign="center">
                <Link href={`/products/${idFromGid(product.id)}`}>
                  <Text as="span" fontWeight="semibold">{product.title}</Text>
                </Link>
                <Badge tone={PRODUCT_STATUS_BADGE[product.status].tone} size="small">
                  {PRODUCT_STATUS_BADGE[product.status].label}
                </Badge>
              </InlineStack>
              <Text as="span" tone="subdued" variant="bodySm">
                {product.categoryName ?? "No category set"}
              </Text>
            </BlockStack>
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            {existingList && existingList.length > 0 && (
              <Badge tone={replaceMode === "all" ? "critical" : replaceMode === "lastUpload" ? "attention" : "success"}>
                {replaceMode === "all"
                  ? `Will replace ${existingList.length} image${existingList.length === 1 ? "" : "s"}`
                  : replaceMode === "lastUpload"
                    ? `Will replace ${lastUploadIds.filter((id) => existingList.some((m) => m.id === id)).length} from last upload`
                    : `${existingList.length} existing image${existingList.length === 1 ? "" : "s"}`}
              </Badge>
            )}
            {status?.state === "processing" && (
              <InlineStack gap="100" blockAlign="center">
                <Spinner size="small" accessibilityLabel="Uploading" />
                <Badge tone="info">{`Uploading ${newItemsDone}/${newItemCount}`}</Badge>
                <Button size="slim" onClick={() => onRestart(group, product)}>
                  Restart
                </Button>
              </InlineStack>
            )}
            {status?.state === "uploaded" && <Badge tone="success">Uploaded</Badge>}
            {status?.state === "error" && <Badge tone="critical">Error</Badge>}
            {status?.state === "error" && (
              <Button size="slim" onClick={() => onRetry(group, product)}>
                Retry
              </Button>
            )}
          </InlineStack>
        </InlineStack>
        {status?.state === "error" && (
          <Text as="p" tone="critical" variant="bodySm">{status.message}</Text>
        )}

        {showMediaPreviews ? (
          <BlockStack gap="100">
            <InlineStack gap="300">
              <InlineStack gap="100" blockAlign="center">
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#008060", display: "inline-block" }} />
                <Text as="span" tone="subdued" variant="bodySm">Already on the product</Text>
              </InlineStack>
              <InlineStack gap="100" blockAlign="center">
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#2c6ecb", display: "inline-block" }} />
                <Text as="span" tone="subdued" variant="bodySm">Queued to upload</Text>
              </InlineStack>
              <Text as="span" tone="subdued" variant="bodySm">— drag to reorder, first image is featured</Text>
            </InlineStack>
            {existingList === undefined ? (
              <Text as="span" tone="subdued" variant="bodySm">Loading images…</Text>
            ) : (
              <MediaReorderRow
                items={orderedItems}
                onReorder={(next) => onReorder(product.id, next)}
                status={imageStatusForSku}
                disabled={uploading}
              />
            )}
          </BlockStack>
        ) : (
          <Text as="span" tone="subdued" variant="bodySm">
            Image previews hidden for faster loading — turn on &ldquo;Show image previews&rdquo; above to view or drag-reorder them.
          </Text>
        )}
      </BlockStack>
    </Box>
  );
});
