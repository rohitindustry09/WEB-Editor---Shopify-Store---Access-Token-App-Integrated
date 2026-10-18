"use client";

import Link from "next/link";
import { Page, Layout, Card, IndexTable, Text, Thumbnail, Box } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import { CursorPagination } from "@/components/ui/CursorPagination";
import { idFromGid } from "@/lib/format";
import { summarizeRuleSet } from "@/lib/collectionRules";
import type { CollectionListItem, PageInfo } from "@/lib/shopify/types";

const PAGE_SIZE = 50;

export function CollectionsView({
  collections,
  page,
  pageInfo,
  error,
}: {
  collections: CollectionListItem[];
  page: number;
  pageInfo: PageInfo;
  error: string | null;
}) {
  return (
    <Page
      fullWidth
      title="Collections"
      backAction={{ content: "Products", url: "/products" }}
      primaryAction={{ content: "📋 Build from list", url: "/products/collections/build" }}
      secondaryActions={[{ content: "Create collection", url: "/products/collections/new" }]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        <Layout.Section>
          {!error && collections.length === 0 ? (
            <ResourceEmptyState
              heading="No collections yet"
              action={{ content: "Create collection", url: "/products/collections/new" }}
            >
              <p>Group products together to feature them in your store.</p>
            </ResourceEmptyState>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "collection", plural: "collections" }}
                itemCount={collections.length}
                selectable={false}
                headings={[
                  { title: "Title" },
                  { title: "Products" },
                  { title: "Conditions" },
                ]}
              >
                {collections.map((c, index) => (
                  <IndexTable.Row id={c.id} key={c.id} position={index}>
                    <IndexTable.Cell>
                      <Link href={`/products/collections/${idFromGid(c.id)}`}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                          <Thumbnail source={c.image?.url ?? ""} alt={c.image?.altText ?? c.title} size="small" />
                          <Text as="span" fontWeight="semibold">{c.title}</Text>
                        </div>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" numeric>{c.productsCount.count}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {c.ruleSet ? summarizeRuleSet(c.ruleSet.rules) : ""}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
              <Box padding="300" borderBlockStartWidth="025" borderColor="border">
                <CursorPagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  count={collections.length}
                  hasNextPage={pageInfo.hasNextPage}
                  hasPreviousPage={pageInfo.hasPreviousPage}
                  startCursor={pageInfo.startCursor}
                  endCursor={pageInfo.endCursor}
                />
              </Box>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
