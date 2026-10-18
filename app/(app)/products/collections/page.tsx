import { CollectionsView } from "./CollectionsView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getCollections } from "@/lib/shopify/collections";
import type { CollectionListItem, PageInfo } from "@/lib/shopify/types";

const EMPTY_PAGE_INFO: PageInfo = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; after?: string; before?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1) || 1;

  let collections: CollectionListItem[] = [];
  let pageInfo: PageInfo = EMPTY_PAGE_INFO;
  let error: string | null = null;

  try {
    const data = await getCollections({
      first: params.before ? undefined : 50,
      last: params.before ? 50 : undefined,
      after: params.after,
      before: params.before,
    });
    collections = data.nodes;
    pageInfo = data.pageInfo;
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading collections.";
  }

  return <CollectionsView collections={collections} page={page} pageInfo={pageInfo} error={error} />;
}
