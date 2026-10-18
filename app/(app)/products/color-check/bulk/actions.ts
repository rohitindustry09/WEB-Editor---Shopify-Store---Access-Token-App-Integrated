"use server";

import { searchProductsBySku, getCategoryAttributes } from "@/lib/shopify/taxonomy";
import { getExistingColorOption, type ExistingColorValue } from "@/lib/shopify/productOptions";
import type { ColorLibraryEntry } from "@/components/products/ColorVariantPicker";

export interface BulkSkuProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  matchedSku: string;
  categoryName: string | null;
  hasColor: boolean | null;
  categoryError: string | null;
  resolvedColors: ColorLibraryEntry[];
  unresolvedNames: string[];
  existingColors: ExistingColorValue[];
}

export interface BulkSkuGroup {
  sku: string;
  products: BulkSkuProduct[];
}

export async function lookupSkuGroupsAction(
  rows: { sku: string; colorNames: string[] }[],
  colorLibrary: ColorLibraryEntry[],
): Promise<{ ok: boolean; groups: BulkSkuGroup[]; error?: string }> {
  try {
    const libraryByName = new Map(colorLibrary.map((c) => [c.name.trim().toLowerCase(), c]));
    const categoryCache = new Map<string, { hasColor: boolean; error: string | null }>();
    const groups: BulkSkuGroup[] = [];

    for (const row of rows) {
      const matches = await searchProductsBySku(row.sku);

      const resolvedColors: ColorLibraryEntry[] = [];
      const unresolvedNames: string[] = [];
      for (const name of row.colorNames) {
        const found = libraryByName.get(name.trim().toLowerCase());
        if (found) resolvedColors.push(found);
        else unresolvedNames.push(name);
      }

      const products: BulkSkuProduct[] = await Promise.all(
        matches.map(async (m) => {
          let hasColor: boolean | null = null;
          let categoryError: string | null = null;

          if (m.category) {
            const cached = categoryCache.get(m.category.id);
            if (cached) {
              hasColor = cached.error ? null : cached.hasColor;
              categoryError = cached.error;
            } else {
              try {
                const attrs = await getCategoryAttributes(m.category.id);
                const result = { hasColor: attrs.some((a) => a.name.toLowerCase() === "color"), error: null };
                categoryCache.set(m.category.id, result);
                hasColor = result.hasColor;
              } catch (err) {
                const message = err instanceof Error ? err.message : "Couldn't load category attributes.";
                categoryCache.set(m.category.id, { hasColor: false, error: message });
                categoryError = message;
              }
            }
          }

          return {
            id: m.id,
            title: m.title,
            imageUrl: m.image?.url ?? null,
            matchedSku: m.sku,
            categoryName: m.category?.fullName ?? null,
            hasColor,
            categoryError,
            resolvedColors,
            unresolvedNames,
            existingColors: await getExistingColorOption(m.id),
          };
        }),
      );

      groups.push({ sku: row.sku, products });
    }

    return { ok: true, groups };
  } catch (err) {
    return { ok: false, groups: [], error: err instanceof Error ? err.message : "Couldn't look up products." };
  }
}
