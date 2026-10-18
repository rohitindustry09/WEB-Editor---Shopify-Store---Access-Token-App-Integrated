"use client";

import Link from "next/link";
import { Page, Layout, Card, IndexTable, Text, InlineStack, BlockStack, Box } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import type { MetaobjectDefinitionSummary } from "@/lib/shopify/metaobjects";

export function MetaobjectsView({
  definitions,
  error,
}: {
  definitions: MetaobjectDefinitionSummary[];
  error: string | null;
}) {
  const totalEntries = definitions.reduce((sum, d) => sum + d.entryCount, 0);

  return (
    <Page
      fullWidth
      title="Metaobjects"
      backAction={{ content: "Content", url: "/content" }}
      secondaryActions={[{ content: "Manage definitions", url: "https://help.shopify.com/manual/custom-data/metaobjects", target: "_blank" }]}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Box minWidth="220px">
              <Card>
                <BlockStack gap="150">
                  <Text as="p" tone="subdued" variant="bodySm">Definitions</Text>
                  <Text as="p" variant="headingLg">{definitions.length}</Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="220px">
              <Card>
                <BlockStack gap="150">
                  <Text as="p" tone="subdued" variant="bodySm">Total entries</Text>
                  <Text as="p" variant="headingLg">{totalEntries}</Text>
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          {!error && definitions.length === 0 ? (
            <ResourceEmptyState heading="No metaobject definitions found">
              <p>Create a definition in Shopify admin, then manage its entries here.</p>
            </ResourceEmptyState>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "definition", plural: "definitions" }}
                itemCount={definitions.length}
                selectable={false}
                headings={[{ title: "Definition name" }, { title: "Type" }, { title: "Entries" }]}
              >
                {definitions.map((d, index) => (
                  <IndexTable.Row id={d.id} key={d.id} position={index}>
                    <IndexTable.Cell>
                      <Link href={`/content/metaobjects/${encodeURIComponent(d.type)}`}>
                        <Text as="span" fontWeight="semibold">{d.name}</Text>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">{d.type}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" numeric>{d.entryCount}</Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
