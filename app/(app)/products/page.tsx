import { ProductsView } from "./ProductsView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getProducts, getProductStats } from "@/lib/shopify/products";
import type { PageInfo, ProductListItem } from "@/lib/shopify/types";

const EMPTY_PAGE_INFO: PageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; status?: string; page?: string; after?: string; before?: string }>;
}) {
  const params = await searchParams;
  const query = params.query ?? "";
  const status = (params.status as "all" | "active" | "draft" | "archived") ?? "all";
  const page = Number(params.page ?? 1) || 1;

  const shopifyQuery = [query, status !== "all" ? `status:${status}` : ""]
    .filter(Boolean)
    .join(" ");

  let products: ProductListItem[] = [];
  let pageInfo: PageInfo = EMPTY_PAGE_INFO;
  let totals: { active: number; draft: number; outOfStock: number } | null = null;
  let error: string | null = null;

  try {
    const [data, stats] = await Promise.all([
      getProducts({
        search: shopifyQuery || undefined,
        first: params.before ? undefined : 50,
        last: params.before ? 50 : undefined,
        after: params.after,
        before: params.before,
      }),
      getProductStats(),
    ]);
    products = data.nodes;
    pageInfo = data.pageInfo;
    totals = stats;
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading products.";
  }

  return (
    <ProductsView
      products={products}
      query={query}
      status={status}
      page={page}
      pageInfo={pageInfo}
      totals={totals}
      error={error}
    />
  );
}
