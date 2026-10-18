"use client";

import { Page, Layout } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ProductDetail } from "@/components/products/ProductDetail";
import type { ProductDetail as ProductDetailType } from "@/lib/shopify/types";

export function ProductDetailView({
  product,
  allCollections,
  error,
}: {
  product: ProductDetailType | null;
  allCollections: { id: string; title: string }[];
  error: string | null;
}) {
  if (error || !product) {
    return (
      <Page fullWidth title="Product" backAction={{ content: "Products", url: "/products" }}>
        <Layout>
          <Layout.Section>
            <ApiErrorBanner error={error ?? "Something went wrong."} />
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      fullWidth
      title={product.title}
      backAction={{ content: "Products", url: "/products" }}
      secondaryActions={[
        { content: "Check color variant eligibility", url: `/products/${product.id.split("/").pop()}/color-check` },
        { content: "Archive", destructive: true },
      ]}
    >
      <ProductDetail product={product} allCollections={allCollections} />
    </Page>
  );
}
