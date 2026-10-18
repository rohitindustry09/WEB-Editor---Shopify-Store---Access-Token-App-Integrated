import { shopifyGraphQL } from "./client";
import type { Connection, CustomerListItem } from "./types";

const CUSTOMERS_QUERY = `
  query Customers($first: Int!) {
    customers(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        displayName
        email
        defaultAddress { city province }
        numberOfOrders
        amountSpent { amount currencyCode }
        tags
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function getCustomers(first = 50): Promise<Connection<CustomerListItem>> {
  const data = await shopifyGraphQL<{ customers: Connection<CustomerListItem> }>(
    CUSTOMERS_QUERY,
    { first },
  );
  return data.customers;
}
