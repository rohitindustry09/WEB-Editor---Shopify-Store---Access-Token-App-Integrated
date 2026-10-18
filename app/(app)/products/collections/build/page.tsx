"use client";

import { Page } from "@shopify/polaris";
import { BulkCollectionBuilder } from "@/components/collections/BulkCollectionBuilder";

export default function BuildCollectionPage() {
  return (
    <Page fullWidth title="Build from list" backAction={{ content: "Collections", url: "/products/collections" }}>
      <BulkCollectionBuilder />
    </Page>
  );
}
