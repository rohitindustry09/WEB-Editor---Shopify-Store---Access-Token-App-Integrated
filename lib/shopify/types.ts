export interface Money {
  amount: string;
  currencyCode: string;
}

export interface ShopInfo {
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  plan: { displayName: string };
}

export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

export interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
}

export interface ProductVariantSummary {
  id: string;
  title: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  taxable: boolean;
  inventoryQuantity: number | null;
  inventoryItem: { id: string; tracked: boolean; measurement: { weight: { value: number; unit: string } | null } };
}

export interface ProductListItem {
  id: string;
  title: string;
  handle: string;
  status: ProductStatus;
  vendor: string;
  productType: string;
  totalInventory: number;
  images: { nodes: ProductImage[] };
  variants: { nodes: ProductVariantSummary[] };
}

export interface ProductDetail extends ProductListItem {
  descriptionHtml: string;
  tags: string[];
  seo: { title: string | null; description: string | null };
  collections: { nodes: { id: string; title: string }[] };
  images: { nodes: ProductImage[] };
}

export type CollectionSortOrder = "MANUAL" | "BEST_SELLING" | "ALPHA_ASC" | "ALPHA_DESC" | "PRICE_ASC" | "PRICE_DESC" | "CREATED" | "CREATED_DESC";

export interface CollectionRule {
  column: string;
  relation: string;
  condition: string;
}

export interface CollectionListItem {
  id: string;
  title: string;
  handle: string;
  updatedAt: string;
  image: ProductImage | null;
  productsCount: { count: number };
  ruleSet: { rules: CollectionRule[]; appliedDisjunctively: boolean } | null;
}

export interface CollectionDetail extends CollectionListItem {
  descriptionHtml: string;
  products: { nodes: ProductListItem[] };
}

export interface OrderLineItemNode {
  title: string;
  quantity: number;
  originalUnitPriceSet: { shopMoney: Money };
  variant: { id: string; product: { id: string } | null } | null;
}

export interface OrderListItem {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  totalPriceSet: { shopMoney: Money };
  customer: { displayName: string } | null;
}

export interface OrderDetail extends OrderListItem {
  shippingAddress: { address1: string | null; city: string | null; province: string | null; zip: string | null; country: string | null } | null;
  lineItems: { nodes: OrderLineItemNode[] };
}

export interface CustomerListItem {
  id: string;
  displayName: string;
  email: string | null;
  defaultAddress: { city: string | null; province: string | null } | null;
  numberOfOrders: string;
  amountSpent: Money;
  tags: string[];
}

export interface InventoryLevelNode {
  location: { id: string; name: string };
  quantities: { name: string; quantity: number }[];
}

export interface InventoryVariantNode {
  id: string;
  sku: string;
  displayName: string;
  inventoryItem: { id: string; inventoryLevels: { nodes: InventoryLevelNode[] } };
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

export interface UserError {
  field: string[] | null;
  message: string;
}
