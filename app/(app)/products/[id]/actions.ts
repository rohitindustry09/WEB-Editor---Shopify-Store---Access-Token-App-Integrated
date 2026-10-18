"use server";

import { revalidatePath } from "next/cache";
import {
  updateProduct,
  updateVariant,
  updateVariantPrice,
  addProductImages,
  deleteProductImages,
  type VariantUpdateInput,
} from "@/lib/shopify/products";
import { addProductsToCollection, removeProductsFromCollection } from "@/lib/shopify/collections";
import { idFromGid } from "@/lib/format";

export interface SaveProductState {
  ok: boolean;
  error?: string;
}

export async function saveProductAction(
  productGid: string,
  variantGid: string | null,
  _prevState: SaveProductState,
  formData: FormData,
): Promise<SaveProductState> {
  const title = String(formData.get("title") ?? "").trim();
  const descriptionHtml = String(formData.get("descriptionHtml") ?? "");
  const price = String(formData.get("price") ?? "").trim();

  if (!title) {
    return { ok: false, error: "Title can't be empty." };
  }

  try {
    const productErrors = await updateProduct({ id: productGid, title, descriptionHtml });
    if (productErrors.length > 0) {
      return { ok: false, error: productErrors.map((e) => e.message).join("; ") };
    }

    if (variantGid && price) {
      const variantErrors = await updateVariantPrice(productGid, variantGid, price);
      if (variantErrors.length > 0) {
        return { ok: false, error: variantErrors.map((e) => e.message).join("; ") };
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save this product." };
  }

  revalidatePath(`/products/${idFromGid(productGid)}`);
  revalidatePath("/products");
  return { ok: true };
}

export async function updateOrganizationAction(input: {
  productGid: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const errors = await updateProduct({
      id: input.productGid,
      vendor: input.vendor,
      productType: input.productType,
      tags: input.tags,
      status: input.status,
    });
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save organization." };
  }
  revalidatePath(`/products/${idFromGid(input.productGid)}`);
  return { ok: true };
}

export async function updateProductCollectionsAction(input: {
  productGid: string;
  addIds: string[];
  removeIds: string[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const collectionId of input.addIds) {
      const errors = await addProductsToCollection(collectionId, [input.productGid]);
      if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
    }
    for (const collectionId of input.removeIds) {
      const errors = await removeProductsFromCollection(collectionId, [input.productGid]);
      if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update collections." };
  }
  revalidatePath(`/products/${idFromGid(input.productGid)}`);
  revalidatePath("/products/collections");
  return { ok: true };
}

export async function saveVariantDetailsAction(
  productGid: string,
  variantGid: string,
  input: VariantUpdateInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const errors = await updateVariant(productGid, variantGid, input);
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save." };
  }
  revalidatePath(`/products/${idFromGid(productGid)}`);
  revalidatePath("/products");
  return { ok: true };
}

export async function addProductImagesAction(
  productGid: string,
  images: { url: string; altText?: string }[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const errors = await addProductImages(productGid, images);
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't add images." };
  }
  revalidatePath(`/products/${idFromGid(productGid)}`);
  return { ok: true };
}

export async function removeProductImageAction(
  productGid: string,
  mediaId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const errors = await deleteProductImages(productGid, [mediaId]);
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't remove image." };
  }
  revalidatePath(`/products/${idFromGid(productGid)}`);
  return { ok: true };
}
