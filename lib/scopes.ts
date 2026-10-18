import type { Capability } from "./types";

export const capabilities: Capability[] = [
  {
    id: "products",
    label: "Edit products & media",
    description: "Products, variants, images, and product organization.",
    scopes: ["read_products", "write_products", "read_publications", "write_publications"],
    required: true,
  },
  {
    id: "collections",
    label: "Build & manage collections",
    description: "Manual and smart collections, including the bulk collection builder.",
    scopes: ["read_products", "write_products"],
    required: true,
  },
  {
    id: "inventory",
    label: "Track & adjust inventory",
    description: "Stock levels, locations, and transfers.",
    scopes: ["read_inventory", "write_inventory", "read_locations"],
    required: false,
  },
  {
    id: "orders",
    label: "View & manage orders",
    description: "Order list, fulfillment status, and order detail.",
    scopes: ["read_orders", "write_orders"],
    required: false,
  },
  {
    id: "customers",
    label: "View customers",
    description: "Customer list and profile detail (read-only).",
    scopes: ["read_customers"],
    required: false,
  },
  {
    id: "discounts",
    label: "Manage discounts",
    description: "Discount codes and automatic discounts.",
    scopes: ["read_price_rules", "write_price_rules"],
    required: false,
  },
  {
    id: "content",
    label: "Manage store content",
    description: "Pages, blog posts, metaobjects (e.g. the Color library), files, and navigation menus.",
    scopes: [
      "read_content",
      "write_content",
      "read_metaobject_definitions",
      "read_metaobjects",
      "write_metaobjects",
      "read_files",
      "write_files",
      "read_online_store_navigation",
      "write_online_store_navigation",
    ],
    required: false,
  },
];

export function scopesFor(selectedIds: string[]): string[] {
  const set = new Set<string>();
  for (const cap of capabilities) {
    if (selectedIds.includes(cap.id)) {
      for (const scope of cap.scopes) set.add(scope);
    }
  }
  return Array.from(set);
}

export const requiredCapabilityIds = capabilities
  .filter((c) => c.required)
  .map((c) => c.id);
