import "server-only";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { getSession } from "@/lib/shopify/session";
import type { LiveStoreInfo } from "./types";

const PAGE_SIZE = 250;
/** Hard stop per resource so a huge catalogue can't run the lookup forever. */
const MAX_PER_RESOURCE = 5000;

interface Connection {
  nodes: { handle: string; blog?: { handle: string } | null }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const SHOP_QUERY = `query SeoLiveShop {
  shop { primaryDomain { url host } }
}`;

function listQuery(field: string, extra = "", filter = ""): string {
  return `query SeoLive($after: String) { ${field}(first: ${PAGE_SIZE}, after: $after${filter}) { nodes { handle ${extra} } pageInfo { hasNextPage endCursor } } }`;
}

async function listHandles(field: string, extra = "", filter = ""): Promise<Connection["nodes"]> {
  const out: Connection["nodes"] = [];
  let after: string | null = null;
  while (out.length < MAX_PER_RESOURCE) {
    const data: Record<string, Connection> = await shopifyGraphQL<Record<string, Connection>>(listQuery(field, extra, filter), { after });
    const conn: Connection = data[field];
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

/** The primary domain of the connected store (the address shoppers actually use), or null when it can't be read. */
export async function getPrimaryDomain(): Promise<{ url: string; host: string } | null> {
  try {
    const data = await shopifyGraphQL<{ shop: { primaryDomain: { url: string; host: string } } }>(SHOP_QUERY);
    return data.shop.primaryDomain;
  } catch {
    return null;
  }
}

/**
 * Every public page of the connected store, read from Shopify itself: the home page plus all published products,
 * collections, pages and blog articles. This is the real total — it doesn't depend on a sitemap being reachable.
 */
export async function getLiveStoreInfo(): Promise<LiveStoreInfo | null> {
  const session = await getSession();
  if (!session) return null;
  const primary = await getPrimaryDomain();
  if (!primary) return null;
  const base = primary.url.replace(/\/+$/, "");
  const errors: string[] = [];
  const safe = async <T,>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : "failed"}`);
      return fallback;
    }
  };
  const [products, collections, pages, articles] = await Promise.all([
    safe("products", () => listHandles("products", "", `, query: "published_status:published"`), []),
    safe("collections", () => listHandles("collections", "", `, query: "published_status:published"`), []),
    safe("pages", () => listHandles("pages", "", `, query: "published_status:published"`), []),
    safe("articles", () => listHandles("articles", "blog { handle }", `, query: "published_status:published"`), []),
  ]);
  const urls = [
    `${base}/`,
    ...collections.map((c) => `${base}/collections/${c.handle}`),
    ...pages.map((p) => `${base}/pages/${p.handle}`),
    ...articles.filter((a) => a.blog?.handle).map((a) => `${base}/blogs/${a.blog!.handle}/${a.handle}`),
    ...products.map((p) => `${base}/products/${p.handle}`),
  ];
  return {
    primaryDomain: base,
    host: primary.host,
    shop: session.shop,
    urls,
    counts: { home: 1, products: products.length, collections: collections.length, pages: pages.length, articles: articles.length },
    total: urls.length,
    errors,
  };
}
