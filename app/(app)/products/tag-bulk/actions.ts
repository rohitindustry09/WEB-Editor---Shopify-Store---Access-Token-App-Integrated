"use server";

import { searchProductsBySku, searchProductsByTitle, type ProductStatus } from "@/lib/shopify/taxonomy";
import { getProductCurrentTags, addProductTags } from "@/lib/shopify/products";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { TagBulkCsvRow } from "@/lib/csvTagBulk";

const LOOKUP_CONCURRENCY = 6;

export interface TagBulkProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  matchedIdentifier: string;
  categoryName: string | null;
  status: ProductStatus;
  currentTags: string[];
  /** "exact" for a full match; "prefix" when matched via the base-name/variant fallback (title search only — always "exact" for SKU matches). */
  matchType: "exact" | "prefix";
}

export interface TagBulkGroup {
  identifier: string;
  tagsToAdd: string[];
  products: TagBulkProduct[];
}

/**
 * Matches every CSV row against the store, by SKU or by exact title
 * depending on the toggle, and fetches each matched product's current tags
 * up front so the UI can tell "will actually add something new" apart from
 * "already has every one of these tags" without a round trip per row later.
 */
export async function lookupTagBulkGroupsAction(
  rows: TagBulkCsvRow[],
  isSku: boolean,
): Promise<{ ok: boolean; groups: TagBulkGroup[]; error?: string }> {
  try {
    const groups = await mapWithConcurrency(rows, LOOKUP_CONCURRENCY, async (row): Promise<TagBulkGroup> => {
      const matches = isSku ? await searchProductsBySku(row.identifier) : await searchProductsByTitle(row.identifier);

      const products: TagBulkProduct[] = await Promise.all(
        matches.map(async (m) => ({
          id: m.id,
          title: m.title,
          imageUrl: m.image?.url ?? null,
          matchedIdentifier: isSku ? m.sku : m.title,
          categoryName: m.category?.fullName ?? null,
          status: m.status,
          matchType: m.matchType,
          currentTags: await getProductCurrentTags(m.id),
        })),
      );

      return { identifier: row.identifier, tagsToAdd: row.tags, products };
    });

    return { ok: true, groups };
  } catch (err) {
    return { ok: false, groups: [], error: err instanceof Error ? err.message : "Couldn't look up products." };
  }
}

export async function addTagsToProductAction(
  productId: string,
  tags: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await addProductTags(productId, tags);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't add tags." };
  }
}
