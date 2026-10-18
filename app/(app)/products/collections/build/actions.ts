"use server";

import { revalidatePath } from "next/cache";
import { createCollection } from "@/lib/shopify/collections";
import { resolveProductIdentifiers } from "@/lib/shopify/products";
import type { ProductListItem } from "@/lib/shopify/types";

export interface ResolvedMatch {
  raw: string;
  product: ProductListItem | null;
}

export async function resolveIdentifiersAction(identifiers: string[]): Promise<{
  ok: boolean;
  matches: ResolvedMatch[];
  error?: string;
}> {
  try {
    const matches = await resolveProductIdentifiers(identifiers);
    return { ok: true, matches };
  } catch (err) {
    return {
      ok: false,
      matches: [],
      error: err instanceof Error ? err.message : "Couldn't look up those products.",
    };
  }
}

export async function createCollectionFromListAction(input: {
  title: string;
  description: string;
  productIds: string[];
}): Promise<{ ok: boolean; handle?: string; error?: string }> {
  if (!input.title.trim()) return { ok: false, error: "Title is required." };
  if (input.productIds.length === 0) return { ok: false, error: "Select at least one product." };

  try {
    const result = await createCollection({
      title: input.title.trim(),
      descriptionHtml: input.description || undefined,
      productIds: input.productIds,
    });
    if (result.userErrors.length > 0) {
      return { ok: false, error: result.userErrors.map((e) => e.message).join("; ") };
    }
    revalidatePath("/products/collections");
    return { ok: true, handle: result.collection?.handle };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't create the collection.",
    };
  }
}
