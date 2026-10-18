export type ProductStatus = "Active" | "Draft" | "Archived";

export interface Product {
  id: string;
  title: string;
  sku: string;
  icon: string;
  status: ProductStatus;
  inventory: number;
  category: string;
  channels: number;
  catalogs: number;
  productType: string;
  vendor: string;
  price: number;
}

export type CollectionType = "manual" | "smart";

export interface Collection {
  id: string;
  title: string;
  type: CollectionType;
  icon: string;
  productIds: string[];
  channels: number;
  updatedAt: string;
  description?: string;
}

export type PaymentStatus = "Paid" | "Pending" | "Refunded";
export type FulfillmentStatus = "Fulfilled" | "Unfulfilled" | "Partial";

export interface OrderLineItem {
  productId: string;
  title: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  name: string;
  date: string;
  customer: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  total: number;
  items: OrderLineItem[];
  shippingAddress: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  location: string;
  orders: number;
  totalSpent: number;
  tags: string[];
}

export interface InventoryRow {
  id: string;
  productId: string;
  title: string;
  sku: string;
  location: string;
  available: number;
  committed: number;
  onHand: number;
}

export type DiscountStatus = "Active" | "Scheduled" | "Expired";

export interface Discount {
  id: string;
  code: string;
  type: "Percentage" | "Fixed amount" | "Free shipping";
  value: string;
  status: DiscountStatus;
  used: number;
}

export interface ContentPage {
  id: string;
  title: string;
  type: "Page" | "Blog post";
  status: "Published" | "Draft";
  updatedAt: string;
  author: string;
}

export interface Market {
  id: string;
  name: string;
  region: string;
  currency: string;
  status: "Active" | "Inactive";
}

export interface Capability {
  id: string;
  label: string;
  description: string;
  scopes: string[];
  required: boolean;
}
