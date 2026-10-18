"use client";

import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Banner, DataTable } from "@shopify/polaris";
import type { ProductCategory, TaxonomyAttribute } from "@/lib/shopify/taxonomy";

export function CategoryCheckView({
  productId,
  productTitle,
  category,
  categoryError,
  attributes,
  attributesError,
}: {
  productId: string;
  productTitle: string | null;
  category: ProductCategory | null;
  categoryError: string | null;
  attributes: TaxonomyAttribute[] | null;
  attributesError: string | null;
}) {
  const hasColorAttribute = attributes?.some((a) => a.name.toLowerCase() === "color") ?? null;

  return (
    <Page
      fullWidth
      title="Color variant eligibility"
      backAction={{ content: productTitle ?? "Product", url: `/products/${productId}` }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Product</Text>
              <Text as="p">{productTitle ?? "—"}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">Category</Text>
              {categoryError ? (
                <Banner tone="critical" title="Couldn't load category">
                  <p>{categoryError}</p>
                </Banner>
              ) : category ? (
                <BlockStack gap="150">
                  <Text as="p">{category.fullName}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    id: {category.id} · leaf: {String(category.isLeaf)}
                  </Text>
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">This product has no category set.</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {category && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingSm">Available attributes for this category</Text>
                  {hasColorAttribute !== null && (
                    <Badge tone={hasColorAttribute ? "success" : "critical"}>
                      {hasColorAttribute ? "Color available" : "Color not available"}
                    </Badge>
                  )}
                </InlineStack>

                {attributesError ? (
                  <Banner tone="critical" title="Couldn't load attributes">
                    <p>{attributesError}</p>
                  </Banner>
                ) : attributes && attributes.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Attribute", "Id", "Type"]}
                    rows={attributes.map((a) => [a.name, a.id, a.typename])}
                  />
                ) : (
                  <Text as="p" tone="subdued">No attributes returned for this category.</Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
