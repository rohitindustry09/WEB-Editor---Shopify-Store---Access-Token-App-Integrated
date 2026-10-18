import { cache } from "react";
import { shopifyGraphQL, shopifyGraphQLRaw } from "./client";
import type { ShopInfo } from "./types";

const SHOP_QUERY = `
  query ShopInfo {
    shop {
      name
      myshopifyDomain
      currencyCode
      plan { displayName }
    }
  }
`;

/**
 * Per-request memoized — the app frame and the page beneath it both want the
 * shop name, and without this each render paid for two identical round trips
 * to Shopify before anything could be shown.
 */
export const getShopInfo = cache(async (): Promise<ShopInfo> => {
  const data = await shopifyGraphQL<{ shop: ShopInfo }>(SHOP_QUERY);
  return data.shop;
});

export async function testShopConnection(
  shop: string,
  token: string,
): Promise<ShopInfo> {
  const data = await shopifyGraphQLRaw<{ shop: ShopInfo }>(shop, token, SHOP_QUERY);
  return data.shop;
}
