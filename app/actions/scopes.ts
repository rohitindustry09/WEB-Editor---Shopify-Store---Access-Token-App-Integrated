"use server";

import { fetchGrantedScopes } from "@/lib/shopify/accessScopes";

/** The access scopes the connected token really has (null when Shopify can't be asked). */
export async function grantedScopesAction(): Promise<string[] | null> {
  try {
    return await fetchGrantedScopes();
  } catch {
    return null;
  }
}
