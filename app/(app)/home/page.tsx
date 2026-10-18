import { HomeView } from "./HomeView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getOrders } from "@/lib/shopify/orders";
import { getProducts } from "@/lib/shopify/products";
import { getInventoryVariants } from "@/lib/shopify/inventory";
import { getShopInfo } from "@/lib/shopify/shop";
import type { OrderListItem, ProductListItem, InventoryVariantNode } from "@/lib/shopify/types";

export default async function HomePage() {
  let shopName = "your store";
  let orders: OrderListItem[] = [];
  let products: ProductListItem[] = [];
  let inventoryVariants: InventoryVariantNode[] = [];
  let error: string | null = null;

  try {
    const [shop, orderData, productData, inventoryData] = await Promise.all([
      getShopInfo(),
      getOrders({ first: 10 }),
      getProducts({ first: 5 }),
      getInventoryVariants(50),
    ]);
    shopName = shop.name;
    orders = orderData.nodes;
    products = productData.nodes;
    inventoryVariants = inventoryData;
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading your dashboard.";
  }

  return (
    <HomeView
      shopName={shopName}
      orders={orders}
      products={products}
      inventoryVariants={inventoryVariants}
      error={error}
    />
  );
}
