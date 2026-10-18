"use server";

import type { Redirect } from "@/lib/merchant/redirects";
import { shopifyGraphQL } from "@/lib/shopify/client";

const PAGE_SIZE = 250;

const REDIRECTS_QUERY = `
  query MerchantRedirects($first: Int!, $after: String) {
    urlRedirects(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { path target }
    }
  }
`;

/** One page (up to 250) of the store's URL redirects. The client loops until there is no next page. */
export async function loadRedirectsPageAction(cursor: string | null): Promise<{ ok: true; redirects: Redirect[]; nextCursor: string | null } | { ok: false; error: string }> {
  try {
    const data = await shopifyGraphQL<{ urlRedirects: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Redirect[] } }>(REDIRECTS_QUERY, {
      first: PAGE_SIZE,
      after: typeof cursor === "string" ? cursor : null,
    });
    const { pageInfo, nodes } = data.urlRedirects;
    return { ok: true, redirects: nodes, nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't read the store's redirects." };
  }
}
