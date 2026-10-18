"use server";

import { shopifyGraphQL } from "@/lib/shopify/client";

// Keeps one request under Shopify's query-cost limit: 20 orders × 40 line items.
const ORDERS_PER_PAGE = 20;
const LINES_PER_ORDER = 40;

const SALES_QUERY = `
  query MerchantSales($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        cancelledAt
        lineItems(first: ${LINES_PER_ORDER}) { nodes { quantity variant { id } } }
      }
    }
  }
`;

export interface SalesPage {
  /** Units sold in this page of orders, by variant id. */
  sold: Record<string, number>;
  orders: number;
  nextCursor: string | null;
}

/** One page of recent orders reduced to units sold per variant (cancelled orders don't count). */
export async function loadSalesPageAction(cursor: string | null, sinceIso: string): Promise<({ ok: true } & SalesPage) | { ok: false; error: string }> {
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return { ok: false, error: "Invalid start date." };
  try {
    const data = await shopifyGraphQL<{
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { cancelledAt: string | null; lineItems: { nodes: { quantity: number; variant: { id: string } | null }[] } }[];
      };
    }>(SALES_QUERY, { first: ORDERS_PER_PAGE, after: typeof cursor === "string" ? cursor : null, query: `created_at:>=${since.toISOString().slice(0, 10)}` });

    const sold: Record<string, number> = {};
    for (const order of data.orders.nodes) {
      if (order.cancelledAt) continue;
      for (const line of order.lineItems.nodes) {
        if (line.variant) sold[line.variant.id] = (sold[line.variant.id] ?? 0) + line.quantity;
      }
    }
    const { pageInfo } = data.orders;
    return { ok: true, sold, orders: data.orders.nodes.length, nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't read orders from the store." };
  }
}
