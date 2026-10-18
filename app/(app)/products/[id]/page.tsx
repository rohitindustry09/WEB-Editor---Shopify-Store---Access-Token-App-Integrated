import { notFound } from "next/navigation";
import { ProductDetailView } from "./ProductDetailView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getProduct } from "@/lib/shopify/products";
import { getCollections } from "@/lib/shopify/collections";
import type { ProductDetail as ProductDetailType } from "@/lib/shopify/types";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let product: ProductDetailType | null = null;
  let allCollections: { id: string; title: string }[] = [];
  let error: string | null = null;

  try {
    const [productResult, collectionsResult] = await Promise.all([
      getProduct(id),
      getCollections({ first: 100 }).catch(() => ({ nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } })),
    ]);
    product = productResult;
    allCollections = collectionsResult.nodes.map((c) => ({ id: c.id, title: c.title }));
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading this product.";
  }

  if (!error && !product) notFound();

  return <ProductDetailView product={product} allCollections={allCollections} error={error} />;
}
