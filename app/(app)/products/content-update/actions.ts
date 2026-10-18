"use server";

import { searchProductsBySku, type ProductStatus } from "@/lib/shopify/taxonomy";
import {
  getProductContentSnapshot,
  updateProductContent,
  type ProductContentSnapshot,
} from "@/lib/shopify/productContent";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { MappedProductContentRow, UpdatableField } from "@/lib/csvProductContent";

const LOOKUP_CONCURRENCY = 6;

export interface ProductContentMatch {
  id: string;
  title: string;
  imageUrl: string | null;
  matchedSku: string;
  status: ProductStatus;
  categoryName: string | null;
  /** What this product currently has, fetched at lookup time so the review UI can show current → new for each field. */
  current: ProductContentSnapshot;
}

export interface ProductContentGroup {
  /** The SKU from the CSV row this group came from. */
  identifier: string;
  lineNumber: number;
  /** Target values from the file, one per field the user mapped — raw strings; tags is still comma-joined here. */
  fields: Partial<Record<UpdatableField, string>>;
  products: ProductContentMatch[];
}

/**
 * Matches every mapped CSV row against the store by SKU, and fetches each
 * matched product's current field values up front so the review UI can show
 * "current → new" without a round trip per row later.
 */
export async function lookupProductContentGroupsAction(
  rows: MappedProductContentRow[],
): Promise<{ ok: boolean; groups: ProductContentGroup[]; error?: string }> {
  try {
    const groups = await mapWithConcurrency(rows, LOOKUP_CONCURRENCY, async (row): Promise<ProductContentGroup> => {
      const matches = await searchProductsBySku(row.sku);

      const products: ProductContentMatch[] = [];
      for (const m of matches) {
        const current = await getProductContentSnapshot(m.id);
        if (!current) continue;
        products.push({
          id: m.id,
          title: m.title,
          imageUrl: m.image?.url ?? null,
          matchedSku: m.sku,
          status: m.status,
          categoryName: m.category?.fullName ?? null,
          current,
        });
      }

      return { identifier: row.sku, lineNumber: row.lineNumber, fields: row.fields, products };
    });

    return { ok: true, groups };
  } catch (err) {
    return { ok: false, groups: [], error: err instanceof Error ? err.message : "Couldn't look up products." };
  }
}

/** Splits a "red, blue, sale" cell into a clean tag list — same convention as the bulk tag-insert tool's CSV parsing. */
function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function applyProductContentUpdateAction(
  productId: string,
  fields: Partial<Record<UpdatableField, string>>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await updateProductContent(productId, {
      title: fields.title,
      descriptionHtml: fields.descriptionHtml,
      tags: fields.tags !== undefined ? splitTags(fields.tags) : undefined,
      seoTitle: fields.seoTitle,
      seoDescription: fields.seoDescription,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update this product." };
  }
}
