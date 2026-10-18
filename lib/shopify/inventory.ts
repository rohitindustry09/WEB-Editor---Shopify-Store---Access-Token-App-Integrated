import { shopifyGraphQL } from "./client";
import type { InventoryVariantNode, UserError } from "./types";

const INVENTORY_QUERY = `
  query InventoryVariants($first: Int!) {
    productVariants(first: $first) {
      nodes {
        id
        sku
        displayName
        inventoryItem {
          id
          inventoryLevels(first: 5) {
            nodes {
              location { id name }
              quantities(names: ["available", "committed", "on_hand"]) { name quantity }
            }
          }
        }
      }
    }
  }
`;

export async function getInventoryVariants(first = 100): Promise<InventoryVariantNode[]> {
  const data = await shopifyGraphQL<{ productVariants: { nodes: InventoryVariantNode[] } }>(
    INVENTORY_QUERY,
    { first },
  );
  return data.productVariants.nodes;
}

const ADJUST_MUTATION = `
  mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

export async function adjustInventory(
  inventoryItemId: string,
  locationId: string,
  delta: number,
): Promise<UserError[]> {
  const data = await shopifyGraphQL<{
    inventoryAdjustQuantities: { userErrors: UserError[] };
  }>(ADJUST_MUTATION, {
    input: {
      reason: "correction",
      name: "available",
      changes: [{ inventoryItemId, locationId, delta }],
    },
  });
  return data.inventoryAdjustQuantities.userErrors;
}
