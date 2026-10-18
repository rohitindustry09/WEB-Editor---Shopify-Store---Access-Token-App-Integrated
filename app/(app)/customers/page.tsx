import { CustomersView } from "./CustomersView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getCustomers } from "@/lib/shopify/customers";
import type { CustomerListItem } from "@/lib/shopify/types";

export default async function CustomersPage() {
  let customers: CustomerListItem[] = [];
  let error: string | null = null;

  try {
    const data = await getCustomers(50);
    customers = data.nodes;
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading customers.";
  }

  return <CustomersView customers={customers} error={error} />;
}
