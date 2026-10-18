"use server";

import { searchProductsBySku } from "@/lib/shopify/taxonomy";
import { getExistingColorOptionWithIds, removeColorOptionValues, type ExistingColorValueWithId } from "@/lib/shopify/productOptions";
import { revalidatePath } from "next/cache";

export interface RemoveSkuProduct {
  id: string;
  title: string;
  imageUrl: string | null;
  matchedSku: string;
  categoryName: string | null;
  existingColors: ExistingColorValueWithId[];
  matchedNames: string[];
  notOnProduct: string[];
}

export interface RemoveSkuGroup {
  sku: string;
  products: RemoveSkuProduct[];
}

export async function lookupSkuGroupsForRemovalAction(
  rows: { sku: string; colorNames: string[] }[],
): Promise<{ ok: boolean; groups: RemoveSkuGroup[]; error?: string }> {
  try {
    const groups: RemoveSkuGroup[] = [];

    for (const row of rows) {
      const matches = await searchProductsBySku(row.sku);

      const products: RemoveSkuProduct[] = await Promise.all(
        matches.map(async (m) => {
          const existingColors = await getExistingColorOptionWithIds(m.id);
          const requested = row.colorNames.map((n) => n.trim().toLowerCase());
          const matchedNames = existingColors
            .filter((v) => requested.includes(v.name.trim().toLowerCase()))
            .map((v) => v.name);
          const notOnProduct = row.colorNames.filter(
            (n) => !existingColors.some((v) => v.name.trim().toLowerCase() === n.trim().toLowerCase()),
          );

          return {
            id: m.id,
            title: m.title,
            imageUrl: m.image?.url ?? null,
            matchedSku: m.sku,
            categoryName: m.category?.fullName ?? null,
            existingColors,
            matchedNames,
            notOnProduct,
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

export async function removeColorVariantAction(
  productId: string,
  colorNames: string[],
): Promise<{ ok: boolean; error?: string }> {
  const result = await removeColorOptionValues(productId, colorNames);
  if (result.ok) {
    revalidatePath("/products/color-check");
    revalidatePath(`/products/${productId.split("/").pop()}`);
  }
  return { ok: result.ok, error: result.error };
}
