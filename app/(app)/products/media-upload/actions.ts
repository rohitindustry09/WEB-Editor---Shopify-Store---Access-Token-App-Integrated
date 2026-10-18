"use server";

import { searchProductsBySku, type ProductStatus } from "@/lib/shopify/taxonomy";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  createStagedUploads,
  attachProductMedia,
  getExistingProductMedia,
  deleteProductMedia,
  reorderProductMedia,
  type StagedUploadTarget,
  type ExistingMediaItem,
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
