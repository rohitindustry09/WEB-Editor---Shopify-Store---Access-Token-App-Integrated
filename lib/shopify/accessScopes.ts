import { shopifyGraphQL } from "./client";

const QUERY = `
  query GrantedScopes {
    currentAppInstallation { accessScopes { handle } }
  }
`;

/** The access scopes this app's token really has right now (read from Shopify, not remembered at connect time). */
export async function fetchGrantedScopes(): Promise<string[]> {
  const data = await shopifyGraphQL<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>(QUERY);
  return data.currentAppInstallation.accessScopes.map((scope) => scope.handle);
}
