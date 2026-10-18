/**
 * What each Shopify Admin API access scope is for, in plain words — so an error that names a scope,
 * or a settings page that lists them, can say what the access unlocks in this editor.
 */
export interface ScopeInfo {
  /** What switching it on lets the editor do. */
  enables: string;
  /** The editor feature area, for grouping. */
  group: string;
}

export const SCOPE_INFO: Record<string, ScopeInfo> = {
  read_products: { group: "Products", enables: "Read products, variants, images, collections and metafields" },
  write_products: { group: "Products", enables: "Create and update products, variants, images, collections and metafields" },
  read_publications: { group: "Products", enables: "See your sales channels (needed to publish products)" },
  write_publications: { group: "Products", enables: "Publish products to, or remove them from, sales channels" },
  read_inventory: { group: "Inventory", enables: "Read stock levels" },
  write_inventory: { group: "Inventory", enables: "Set stock quantities" },
  read_locations: { group: "Inventory", enables: "See your stock locations (needed to set a quantity)" },
  read_orders: { group: "Orders", enables: "Read orders" },
  write_orders: { group: "Orders", enables: "Update orders and fulfilment" },
  read_customers: { group: "Customers", enables: "Read customers (names, emails and addresses also need protected customer data access)" },
  read_price_rules: { group: "Discounts", enables: "Read discounts" },
  write_price_rules: { group: "Discounts", enables: "Create and update discounts" },
  read_content: { group: "Content", enables: "Read pages and blog posts" },
  write_content: { group: "Content", enables: "Edit pages and blog posts" },
  read_metaobject_definitions: { group: "Content", enables: "Read metaobject types (such as the Color library)" },
  read_metaobjects: { group: "Content", enables: "Read metaobject entries" },
  write_metaobjects: { group: "Content", enables: "Create and update metaobject entries" },
  read_files: { group: "Content", enables: "Read uploaded files" },
  write_files: { group: "Content", enables: "Upload files" },
  read_online_store_navigation: { group: "Content", enables: "Read navigation menus" },
  write_online_store_navigation: { group: "Content", enables: "Edit navigation menus" },
};

export const ALL_SCOPES: string[] = Object.keys(SCOPE_INFO);

const SCOPE_PATTERN = /\b((?:unauthenticated_)?(?:read|write)_[a-z][a-z_]*)\b/g;

/** Scope names mentioned in text: every known one, plus any that Shopify puts in backticks before "access scope". */
export function scopesMentionedIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/`([a-z_]+)`\s+access\s+scope/gi)) found.add(match[1].toLowerCase());
  for (const match of text.matchAll(SCOPE_PATTERN)) {
    if (match[1] in SCOPE_INFO) found.add(match[1]);
  }
  return [...found];
}
