import { notFound } from "next/navigation";
import { CollectionDetailView } from "./CollectionDetailView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getCollection } from "@/lib/shopify/collections";
import type { CollectionDetail as CollectionDetailType } from "@/lib/shopify/types";

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let collection: CollectionDetailType | null = null;
  let error: string | null = null;

  try {
    collection = await getCollection(id);
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading this collection.";
  }

  if (!error && !collection) notFound();

  return <CollectionDetailView collection={collection} error={error} />;
}
