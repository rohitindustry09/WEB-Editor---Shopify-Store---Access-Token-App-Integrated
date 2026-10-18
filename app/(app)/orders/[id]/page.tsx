import { notFound } from "next/navigation";
import { OrderDetailView } from "./OrderDetailView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getOrder } from "@/lib/shopify/orders";
import type { OrderDetail } from "@/lib/shopify/types";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let order: OrderDetail | null = null;
  let error: string | null = null;

  try {
    order = await getOrder(id);
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading this order.";
  }

  if (!error && !order) notFound();

  return <OrderDetailView order={order} error={error} />;
}
