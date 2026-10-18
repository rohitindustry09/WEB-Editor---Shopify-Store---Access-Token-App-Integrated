import { AnalyticsView } from "./AnalyticsView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getOrders, getOrder } from "@/lib/shopify/orders";
import { idFromGid } from "@/lib/format";

export default async function AnalyticsPage() {
  let error: string | null = null;
  let salesSeries: { label: string; value: number }[] = [];
  let topProducts: { title: string; revenue: number; image: string | null }[] = [];
  let currencyCode = "USD";
  let totalRevenue = 0;
  let avgOrderValue = 0;

  try {
    const data = await getOrders({ first: 50 });
    const orders = data.nodes;
    currencyCode = orders[0]?.totalPriceSet.shopMoney.currencyCode ?? "USD";

    const byDay = new Map<string, number>();
    for (const order of orders) {
      const day = order.createdAt.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + Number(order.totalPriceSet.shopMoney.amount));
    }
    salesSeries = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([day, value]) => ({
        label: new Date(day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value,
      }));
    totalRevenue = salesSeries.reduce((sum, d) => sum + d.value, 0);
    avgOrderValue = orders.length
      ? orders.reduce((sum, o) => sum + Number(o.totalPriceSet.shopMoney.amount), 0) / orders.length
      : 0;

    const detailed = await Promise.all(
      orders.slice(0, 15).map((o) => getOrder(idFromGid(o.id)).catch(() => null)),
    );
    const revenueByProduct = new Map<string, { title: string; revenue: number }>();
    for (const order of detailed) {
      if (!order) continue;
      for (const item of order.lineItems.nodes) {
        const key = item.variant?.product?.id ?? item.title;
        const revenue = Number(item.originalUnitPriceSet.shopMoney.amount) * item.quantity;
        const existing = revenueByProduct.get(key);
        revenueByProduct.set(key, {
          title: item.title,
          revenue: (existing?.revenue ?? 0) + revenue,
        });
      }
    }
    topProducts = Array.from(revenueByProduct.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((p) => ({ ...p, image: null }));
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading analytics.";
  }

  return (
    <AnalyticsView
      error={error}
      totalRevenue={totalRevenue}
      avgOrderValue={avgOrderValue}
      currencyCode={currencyCode}
      salesSeries={salesSeries}
      topProducts={topProducts}
    />
  );
}
