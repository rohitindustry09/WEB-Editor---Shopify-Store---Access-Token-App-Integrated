"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCollection, type CollectionRuleInput } from "@/lib/shopify/collections";
import { idFromGid } from "@/lib/format";

export interface CreateCollectionState {
  ok: boolean;
  error?: string;
}

export async function createCollectionAction(input: {
  title: string;
  description: string;
  imageUrl: string;
  type: "manual" | "automated";
  productIds: string[];
  appliedDisjunctively: boolean;
  rules: CollectionRuleInput[];
}): Promise<CreateCollectionState> {
  if (!input.title.trim()) return { ok: false, error: "Title is required." };
  if (input.type === "automated" && input.rules.filter((r) => r.condition.trim()).length === 0) {
    return { ok: false, error: "Add at least one condition for an automated collection." };
  }

  let collectionId: string | null = null;
  try {
    const result = await createCollection({
      title: input.title,
      descriptionHtml: input.description || undefined,
      imageUrl: input.imageUrl || undefined,
      productIds: input.type === "manual" ? input.productIds : undefined,
      ruleSet:
        input.type === "automated"
          ? { appliedDisjunctively: input.appliedDisjunctively, rules: input.rules.filter((r) => r.condition.trim()) }
          : undefined,
    });
    if (result.userErrors.length > 0) {
      return { ok: false, error: result.userErrors.map((e) => e.message).join("; ") };
    }
    collectionId = result.collection?.id ?? null;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't create collection." };
  }

  revalidatePath("/products/collections");
  if (collectionId) redirect(`/products/collections/${idFromGid(collectionId)}`);
  return { ok: true };
}
