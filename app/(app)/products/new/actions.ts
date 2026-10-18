"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createProduct,
  getProductVendors,
  getProductTypes,
  getProductTags,
  type CreateProductInput,
} from "@/lib/shopify/products";
import { idFromGid } from "@/lib/format";

export async function searchVendorsAction(query: string): Promise<string[]> {
  return getProductVendors(query).catch(() => []);
}

export async function searchTypesAction(query: string): Promise<string[]> {
  return getProductTypes(query).catch(() => []);
}

export async function searchTagsAction(query: string): Promise<string[]> {
  return getProductTags(query).catch(() => []);
}

export interface CreateProductState {
  ok: boolean;
  error?: string;
}

export async function createProductAction(
  input: CreateProductInput,
): Promise<CreateProductState> {
  if (!input.title.trim()) return { ok: false, error: "Title is required." };

  let productId: string | null = null;
  try {
    const result = await createProduct(input);
    if (result.userErrors.length > 0) {
      return { ok: false, error: result.userErrors.map((e) => e.message).join("; ") };
    }
    productId = result.id;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't create product." };
  }

  revalidatePath("/products");
  if (productId) redirect(`/products/${idFromGid(productId)}`);
  return { ok: true };
}
