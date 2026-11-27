"use server";

import { searchProductsBySku, type ProductStatus } from "@/lib/shopify/taxonomy";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  createStagedUploads,
  attachProductMedia,
  getExistingProductMedia,
  deleteProductMedia,
  reorderProductMedia,
  getOrderedProductMedia,
  replaceImageSource,
  type StagedUploadTarget,
  type ExistingMediaItem,
  type OrderedMediaNode,
} from "@/lib/shopify/media";
import { revalidatePath } from "next/cache";

const LOOKUP_CONCURRENCY = 6;
const MEDIA_FETCH_CONCURRENCY = 8;

export type { ProductStatus };

export interface MediaSkuProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  matchedSku: string;
  categoryName: string | null;
  status: ProductStatus;
}

export interface MediaSkuGroup {
  sku: string;
  imageCount: number;
  products: MediaSkuProduct[];
}

/**
 * Matches every SKU folder against the store. Deliberately does NOT fetch
 * each product's existing media here — that used to mean one extra
 * GraphQL round trip per matched product, all before the page could show
 * anything, which is what made a 70+ SKU zip feel like it hung. Existing
 * images are fetched separately, lazily, only for whatever's on screen.
 */
export async function lookupProductsForMediaAction(
  folders: { sku: string; imageCount: number }[],
): Promise<{ ok: boolean; groups: MediaSkuGroup[]; error?: string }> {
  try {
    const results = await mapWithConcurrency(folders, LOOKUP_CONCURRENCY, async (folder) => {
      const matches = await searchProductsBySku(folder.sku);
      const group: MediaSkuGroup = {
        sku: folder.sku,
        imageCount: folder.imageCount,
        products: matches.map((m) => ({
          id: m.id,
          title: m.title,
          imageUrl: m.image?.url ?? null,
          matchedSku: m.sku,
          categoryName: m.category?.fullName ?? null,
          status: m.status,
        })),
      };
      return group;
    });

    return { ok: true, groups: results };
  } catch (err) {
    return { ok: false, groups: [], error: err instanceof Error ? err.message : "Couldn't look up products." };
  }
}

/** Fetches existing product images for a batch of products at once — used to lazily fill in the on-screen preview/reorder UI only for whichever products are currently visible. */
export async function getExistingMediaBatchAction(
  productIds: string[],
): Promise<Record<string, ExistingMediaItem[]>> {
  const results = await mapWithConcurrency(productIds, MEDIA_FETCH_CONCURRENCY, async (id) => {
    const existing = await getExistingProductMedia(id);
    return [id, existing.media] as const;
  });
  return Object.fromEntries(results);
}

export async function createStagedUploadsAction(
  files: { filename: string; mimeType: string; fileSize: string }[],
): Promise<{ ok: boolean; targets: StagedUploadTarget[]; error?: string }> {
  try {
    return await createStagedUploads(files);
  } catch (err) {
    return { ok: false, targets: [], error: err instanceof Error ? err.message : "Couldn't prepare the upload." };
  }
}

export async function clearProductMediaAction(productId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const existing = await getExistingProductMedia(productId);
    if (existing.media.length === 0) return { ok: true };
    return await deleteProductMedia(productId, existing.media.map((m) => m.id));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't clear the existing images." };
  }
}

export async function deleteProductMediaIdsAction(
  productId: string,
  mediaIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await deleteProductMedia(productId, mediaIds);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't delete the previous upload." };
  }
}

export async function attachProductMediaAction(
  productId: string,
  files: { resourceUrl: string; alt: string }[],
): Promise<{ ok: boolean; mediaIds: string[]; error?: string }> {
  try {
    const result = await attachProductMedia(productId, files);
    if (result.ok) revalidatePath(`/products/${productId.split("/").pop()}`);
    return result;
  } catch (err) {
    return { ok: false, mediaIds: [], error: err instanceof Error ? err.message : "Couldn't attach the images." };
  }
}

export async function reorderProductMediaAction(
  productId: string,
  orderedMediaIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await reorderProductMedia(productId, orderedMediaIds);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reorder the images." };
  }
}

export type OrderedMediaResult = { ok: true; media: OrderedMediaNode[] } | { ok: false; error: string };

/** Each product's full gallery in position order, for the position-based uploader. A product that can't be read reports its own error instead of failing the batch. */
export async function getOrderedMediaBatchAction(productIds: string[]): Promise<Record<string, OrderedMediaResult>> {
  const results = await mapWithConcurrency(productIds, MEDIA_FETCH_CONCURRENCY, async (id): Promise<readonly [string, OrderedMediaResult]> => {
    try {
      const media = await getOrderedProductMedia(id);
      return [id, media ? { ok: true, media } : { ok: false, error: "Product not found." }] as const;
    } catch (err) {
      return [id, { ok: false, error: err instanceof Error ? err.message : "Couldn't read the product's images." }] as const;
    }
  });
  return Object.fromEntries(results);
}

export interface PositionReplacement {
  /** 1 = the first (featured) image. */
  position: number;
  /** The staged upload holding the new picture. */
  resourceUrl: string;
  /** The media item the page saw at this position when it scanned; the replacement is refused if it has since changed. */
  expectedMediaId: string;
}

export interface PositionReplacementResult {
  position: number;
  ok: boolean;
  error?: string;
}

/**
 * Replaces the pictures at the given positions, one at a time. The product's gallery is read again first, and a position is
 * only touched if it still holds the very image the page showed — otherwise someone reordered or edited the product in
 * between and the wrong picture could be overwritten.
 */
export async function replaceMediaAtPositionsAction(
  productId: string,
  items: PositionReplacement[],
): Promise<{ ok: boolean; results: PositionReplacementResult[]; error?: string }> {
  let media: OrderedMediaNode[] | null;
  try {
    media = await getOrderedProductMedia(productId);
  } catch (err) {
    return { ok: false, results: [], error: err instanceof Error ? err.message : "Couldn't read the product's images." };
  }
  if (!media) return { ok: false, results: [], error: "Product not found." };

  const results: PositionReplacementResult[] = [];
  for (const item of items) {
    const current = media[item.position - 1];
    if (!current) {
      results.push({ position: item.position, ok: false, error: "The product no longer has an image at this position." });
    } else if (current.id !== item.expectedMediaId) {
      results.push({ position: item.position, ok: false, error: "The images were changed since the scan — scan again." });
    } else if (current.kind !== "IMAGE" || current.status !== "READY") {
      results.push({ position: item.position, ok: false, error: "That image isn't ready to be replaced yet." });
    } else {
      try {
        const done = await replaceImageSource(current.id, item.resourceUrl);
        results.push({ position: item.position, ...done });
      } catch (err) {
        results.push({ position: item.position, ok: false, error: err instanceof Error ? err.message : "Couldn't replace the image." });
      }
    }
  }
  if (results.some((r) => r.ok)) revalidatePath(`/products/${productId.split("/").pop()}`);
  return { ok: results.every((r) => r.ok), results };
}

export interface ImageRestore {
  mediaId: string;
  /** The staged upload holding the saved copy. */
  resourceUrl: string;
}

export interface ImageRestoreResult {
  mediaId: string;
  ok: boolean;
  error?: string;
}

/**
 * Puts saved pictures back into the images they came from, matched by image id — not position, so a product that was
 * reordered since still gets the right picture back. An image that no longer belongs to the product (deleted, or
 * moved off it) is reported instead of touched.
 */
export async function restoreMediaImagesAction(
  productId: string,
  items: ImageRestore[],
): Promise<{ ok: boolean; results: ImageRestoreResult[]; error?: string }> {
  let media: OrderedMediaNode[] | null;
  try {
    media = await getOrderedProductMedia(productId);
  } catch (err) {
    return { ok: false, results: [], error: err instanceof Error ? err.message : "Couldn't read the product's images." };
  }
  if (!media) return { ok: false, results: [], error: "Product not found." };

  const byId = new Map(media.map((m) => [m.id, m]));
  const results: ImageRestoreResult[] = [];
  for (const item of items) {
    const current = byId.get(item.mediaId);
    if (!current) {
      results.push({ mediaId: item.mediaId, ok: false, error: "This image is no longer on the product." });
    } else if (current.kind !== "IMAGE" || current.status !== "READY") {
      results.push({ mediaId: item.mediaId, ok: false, error: "Shopify is still processing this image — try again in a minute." });
    } else {
      try {
        results.push({ mediaId: item.mediaId, ...(await replaceImageSource(current.id, item.resourceUrl)) });
      } catch (err) {
        results.push({ mediaId: item.mediaId, ok: false, error: err instanceof Error ? err.message : "Couldn't restore the image." });
      }
    }
  }
  if (results.some((r) => r.ok)) revalidatePath(`/products/${productId.split("/").pop()}`);
  return { ok: results.every((r) => r.ok), results };
}
