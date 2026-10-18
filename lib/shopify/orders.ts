import { shopifyGraphQL } from "./client";
import type { Connection, OrderDetail, OrderListItem } from "./types";

const ORDER_LIST_FIELDS = `
  id
  name
  createdAt
  displayFinancialStatus
  displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { displayName }
`;

const ORDERS_QUERY = `
  query Orders($first: Int!, $query: String) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes { ${ORDER_LIST_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function getOrders(options?: {
  first?: number;
  filter?: "unfulfilled" | "unpaid" | "closed" | "open";
}): Promise<Connection<OrderListItem>> {
  const filterMap: Record<string, string> = {
    unfulfilled: "fulfillment_status:unfulfilled",
    unpaid: "financial_status:pending OR financial_status:partially_paid",
    closed: "fulfillment_status:fulfilled",
    open: "fulfillment_status:unfulfilled OR fulfillment_status:partial",
  };
  const data = await shopifyGraphQL<{ orders: Connection<OrderListItem> }>(ORDERS_QUERY, {
    first: options?.first ?? 50,
    query: options?.filter ? filterMap[options.filter] : undefined,
  });
  return data.orders;
}

const ORDER_QUERY = `
  query Order($id: ID!) {
    order(id: $id) {
      ${ORDER_LIST_FIELDS}
      shippingAddress { address1 city province zip country }
      lineItems(first: 50) {
        nodes {
          title
          quantity
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          variant { id product { id } }
        }
      }
    }
  }
`;

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
  const data = await shopifyGraphQL<{ order: OrderDetail | null }>(ORDER_QUERY, { id: gid });
  return data.order;
}
