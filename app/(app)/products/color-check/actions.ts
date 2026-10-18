"use server";

import { revalidatePath } from "next/cache";
import { addColorOption, type ColorOptionValue } from "@/lib/shopify/productOptions";

export interface AddColorVariantState {
  ok: boolean;
  error?: string;
  alreadyPresent?: string[];
}

export async function addColorVariantAction(
  productId: string,
  colors: ColorOptionValue[],
): Promise<AddColorVariantState> {
  if (colors.length === 0) {
    return { ok: false, error: "Select at least one color first." };
  }

  let result: AddColorVariantState;
  try {
    result = await addColorOption(productId, colors);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't add the color variant." };
  }
  if (!result.ok) return result;

  revalidatePath("/products/color-check");
  revalidatePath(`/products/${productId.split("/").pop()}`);
  return result;
}
