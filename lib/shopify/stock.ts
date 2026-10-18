import { shopifyGraphQL } from "./client";

/** A place the store keeps stock (a warehouse, a shop, …). */
export interface StockLocation {
  id: string;
  name: string;
}

const LOCATIONS_QUERY = `
  query StockLocations {
    locations(first: 50) { nodes { id name isActive } }
  }
`;

/** The store's active stock locations — needs the read_locations scope. */
export async function getLocations(): Promise<StockLocation[]> {
  const data = await shopifyGraphQL<{ locations: { nodes: { id: string; name: string; isActive: boolean }[] } }>(LOCATIONS_QUERY);
  return data.locations.nodes.filter((n) => n.isActive).map((n) => ({ id: n.id, name: n.name }));
}

const VARIANT_ITEM_QUERY = `
  query VariantInventoryItem($id: ID!) {
    productVariant(id: $id) { inventoryItem { id tracked } }
  }
`;

const TRACK_MUTATION = `
  mutation TrackInventory($id: ID!) {
    inventoryItemUpdate(id: $id, input: { tracked: true }) { userErrors { message } }
  }
`;

const SET_QUANTITY_MUTATION = `
  mutation SetStock($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) { userErrors { field message code } }
  }
`;

const ACTIVATE_MUTATION = `
  mutation ActivateStock($itemId: ID!, $locationId: ID!, $available: Int) {
    inventoryActivate(inventoryItemId: $itemId, locationId: $locationId, available: $available) { userErrors { field message } }
  }
`;

interface InventoryUserError {
  field?: string[] | null;
  message: string;
  code?: string;
}

const errorsText = (errors: { message: string }[]): string => errors.map((e) => e.message).join("; ");
const isNotStocked = (errors: InventoryUserError[]): boolean =>
  errors.some((e) => e.code === "ITEM_NOT_STOCKED_AT_LOCATION" || /not stocked|isn't stocked|is not stocked/i.test(e.message));

/**
 * Sets the "available" stock of a variant at one location to exactly `quantity`
 * (it replaces the number, it doesn't add to it). Inventory has to be tracked for
 * a quantity to mean anything, so tracking is switched on first; and if the item
 * isn't stocked at that location yet, it is activated there with this quantity.
 * Returns readable problems — empty means it worked. Needs write_inventory.
 */
export async function setVariantQuantity(variantId: string, locationId: string, quantity: number): Promise<string[]> {
  const problems: string[] = [];
  try {
    const found = await shopifyGraphQL<{ productVariant: { inventoryItem: { id: string; tracked: boolean } } | null }>(VARIANT_ITEM_QUERY, { id: variantId });
    const item = found.productVariant?.inventoryItem;
    if (!item) return ["Inventory quantity: the variant's inventory item couldn't be found."];

    if (!item.tracked) {
      const tracked = await shopifyGraphQL<{ inventoryItemUpdate: { userErrors: { message: string }[] } }>(TRACK_MUTATION, { id: item.id });
      if (tracked.inventoryItemUpdate.userErrors.length > 0) {
        problems.push(`Inventory tracking: ${errorsText(tracked.inventoryItemUpdate.userErrors)}`);
      }
    }

    const set = await shopifyGraphQL<{ inventorySetQuantities: { userErrors: InventoryUserError[] } }>(SET_QUANTITY_MUTATION, {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [{ inventoryItemId: item.id, locationId, quantity }],
      },
    });
    const errors = set.inventorySetQuantities.userErrors;
    if (errors.length === 0) return problems;

    if (isNotStocked(errors)) {
      const activated = await shopifyGraphQL<{ inventoryActivate: { userErrors: { message: string }[] } }>(ACTIVATE_MUTATION, {
        itemId: item.id,
        locationId,
        available: quantity,
      });
      if (activated.inventoryActivate.userErrors.length > 0) {
        problems.push(`Inventory quantity: ${errorsText(activated.inventoryActivate.userErrors)}`);
      }
      return problems;
    }
    problems.push(`Inventory quantity: ${errorsText(errors)}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unexpected error";
    problems.push(`Inventory quantity: ${reason}. The access token needs the read_inventory, write_inventory and read_locations scopes.`);
  }
  return problems;
}

const VARIANT_STOCK_QUERY = `
  query VariantStock($id: ID!, $locationId: ID!) {
    productVariant(id: $id) {
      inventoryItem {
        inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } }
      }
    }
  }
`;

/** The variant's "available" stock at a location, read back from the store — null when it can't be read. */
export async function readVariantQuantity(variantId: string, locationId: string): Promise<number | null> {
  try {
    const data = await shopifyGraphQL<{
      productVariant: { inventoryItem: { inventoryLevel: { quantities: { name: string; quantity: number }[] } | null } } | null;
    }>(VARIANT_STOCK_QUERY, { id: variantId, locationId });
    const level = data.productVariant?.inventoryItem.inventoryLevel;
    return level?.quantities.find((q) => q.name === "available")?.quantity ?? null;
  } catch {
    return null;
  }
}
