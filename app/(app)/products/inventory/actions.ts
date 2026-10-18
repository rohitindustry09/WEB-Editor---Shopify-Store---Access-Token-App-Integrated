"use server";

import { revalidatePath } from "next/cache";
import { adjustInventory } from "@/lib/shopify/inventory";

export async function adjustInventoryAction(
  inventoryItemId: string,
  locationId: string,
  delta: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const errors = await adjustInventory(inventoryItemId, locationId, delta);
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't adjust inventory." };
  }
  revalidatePath("/products/inventory");
  return { ok: true };
}
