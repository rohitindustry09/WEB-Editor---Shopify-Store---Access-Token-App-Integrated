"use client";

import { Page, Layout } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { CollectionDetail } from "@/components/collections/CollectionDetail";
import type { CollectionDetail as CollectionDetailType } from "@/lib/shopify/types";

export function CollectionDetailView({
  collection,
  error,
}: {
  collection: CollectionDetailType | null;
  error: string | null;
}) {
  if (error || !collection) {
    return (
      <Page title="Collection" backAction={{ content: "Collections", url: "/products/collections" }}>
        <Layout>
          <Layout.Section>
            <ApiErrorBanner error={error ?? "Something went wrong."} />
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title={collection.title} backAction={{ content: "Collections", url: "/products/collections" }}>
      <CollectionDetail collection={collection} />
    </Page>
  );
}
