export const SHOPIFY_API_VERSION = "2025-01";

export const SHOP_COOKIE = "shopify_shop";
export const TOKEN_COOKIE = "shopify_token";
export const SCOPES_COOKIE = "shopify_scopes";

export function adminGraphQLUrl(shop: string): string {
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}
