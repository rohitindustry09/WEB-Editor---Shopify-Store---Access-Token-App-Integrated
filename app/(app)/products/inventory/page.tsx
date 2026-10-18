import { InventoryView } from "./InventoryView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getInventoryVariants } from "@/lib/shopify/inventory";
import type { InventoryVariantNode } from "@/lib/shopify/types";

export default async function InventoryPage() {
  let rows: InventoryVariantNode[] = [];
  let error: string | null = null;

  try {
    rows = await getInventoryVariants(100);
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading inventory.";
  }

  return <InventoryView rows={rows} error={error} />;
}
