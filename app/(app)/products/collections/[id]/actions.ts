"use server";

import { revalidatePath } from "next/cache";
import {
  addProductsToCollection,
  removeProductsFromCollection,
  updateCollectionRuleSet,
  type CollectionRuleInput,
} from "@/lib/shopify/collections";
import { idFromGid } from "@/lib/format";

export async function addProductToCollectionAction(
  collectionId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const errors = await addProductsToCollection(collectionId, [productId]);
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't add product." };
  }
  revalidatePath(`/products/collections/${idFromGid(collectionId)}`);
  return { ok: true };
}

export async function removeProductFromCollectionAction(
  collectionId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const errors = await removeProductsFromCollection(collectionId, [productId]);
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't remove product." };
  }
  revalidatePath(`/products/collections/${idFromGid(collectionId)}`);
  return { ok: true };
}

export async function updateRuleSetAction(
  collectionId: string,
  appliedDisjunctively: boolean,
  rules: CollectionRuleInput[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const errors = await updateCollectionRuleSet(collectionId, {
      appliedDisjunctively,
      rules: rules.filter((r) => r.condition.trim()),
    });
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update conditions." };
  }
  revalidatePath(`/products/collections/${idFromGid(collectionId)}`);
  return { ok: true };
}
