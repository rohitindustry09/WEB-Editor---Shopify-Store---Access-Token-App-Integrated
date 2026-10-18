"use client";

import { Page, Layout, Card, InlineStack, BlockStack, Text, Box } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import { ProductsIndexTable } from "@/components/products/ProductsIndexTable";
import type { PageInfo, ProductListItem } from "@/lib/shopify/types";

export function ProductsView({
  products,
  query,
  status,
  page,
  pageInfo,
  totals,
  error,
}: {
  products: ProductListItem[];
  query: string;
  status: "all" | "active" | "draft" | "archived";
  page: number;
  pageInfo: PageInfo;
  totals: { active: number; draft: number; outOfStock: number } | null;
  error: string | null;
}) {
  return (
    <Page
      fullWidth
      title="Products"
      primaryAction={{ content: "Add product", url: "/products/new" }}
      secondaryActions={[{ content: "Export" }, { content: "Import" }]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        {totals && (
          <Layout.Section>
            <Card padding="0">
              <InlineStack gap="0">
                <StatCell label="Active" value={String(totals.active)} />
                <StatCell label="Draft" value={String(totals.draft)} />
                <StatCell label="Out of stock" value={String(totals.outOfStock)} />
              </InlineStack>
            </Card>
          </Layout.Section>
        )}
        <Layout.Section>
          {!error && products.length === 0 ? (
            <ResourceEmptyState heading="No products found" action={{ content: "Add product", url: "/products/new" }}>
              <p>Try a different search, or add your first product.</p>
            </ResourceEmptyState>
          ) : (
            <ProductsIndexTable
              products={products}
              initialQuery={query}
              initialStatus={status}
              page={page}
              pageInfo={pageInfo}
            />
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <Box padding="400" minWidth="140px" borderInlineEndWidth="025" borderColor="border">
      <BlockStack gap="050">
        <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
        <Text as="p" variant="headingLg">{value}</Text>
      </BlockStack>
    </Box>
  );
}
