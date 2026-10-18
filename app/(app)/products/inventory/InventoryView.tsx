"use client";

import { Page, Layout } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import type { InventoryVariantNode } from "@/lib/shopify/types";

export function InventoryView({
  rows,
  error,
}: {
  rows: InventoryVariantNode[];
  error: string | null;
}) {
  return (
    <Page fullWidth
      title="Inventory"
      backAction={{ content: "Products", url: "/products" }}
      secondaryActions={[{ content: "Import" }, { content: "Export" }]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        <Layout.Section>
          {!error && rows.length === 0 ? (
            <ResourceEmptyState heading="No inventory tracked yet">
              <p>Variants with inventory tracking enabled will show up here.</p>
            </ResourceEmptyState>
          ) : (
            <InventoryTable rows={rows} />
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
