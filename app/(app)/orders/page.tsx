import { OrdersView } from "./OrdersView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getOrders } from "@/lib/shopify/orders";
import type { OrderListItem } from "@/lib/shopify/types";

type OrderFilter = "all" | "unfulfilled" | "unpaid" | "closed";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = (params.filter as OrderFilter) ?? "all";

  let orders: OrderListItem[] = [];
  let error: string | null = null;

  try {
    const data = await getOrders({ first: 50, filter: filter === "all" ? undefined : filter });
    orders = data.nodes;
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading orders.";
  }

  return <OrdersView orders={orders} filter={filter} error={error} />;
}
