"use client";

import { Page, Layout, Card, IndexTable, Text, Tag, InlineStack } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import { formatMoney } from "@/lib/format";
import type { CustomerListItem } from "@/lib/shopify/types";

export function CustomersView({
  customers,
  error,
}: {
  customers: CustomerListItem[];
  error: string | null;
}) {
  return (
    <Page fullWidth title="Customers" secondaryActions={[{ content: "Export" }]}>
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        <Layout.Section>
          {!error && customers.length === 0 ? (
            <ResourceEmptyState heading="No customers yet">
              <p>Customers will show up here as they place orders.</p>
            </ResourceEmptyState>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "customer", plural: "customers" }}
                itemCount={customers.length}
                selectable={false}
                headings={[
                  { title: "Customer" },
                  { title: "Location" },
                  { title: "Orders" },
                  { title: "Total spent" },
                  { title: "Tags" },
                ]}
              >
                {customers.map((c, index) => (
                  <IndexTable.Row id={c.id} key={c.id} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">{c.displayName}</Text>
                      <br />
                      <Text as="span" tone="subdued" variant="bodySm">{c.email ?? "—"}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {[c.defaultAddress?.city, c.defaultAddress?.province].filter(Boolean).join(", ") || "—"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" numeric>{c.numberOfOrders}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" numeric>{formatMoney(c.amountSpent)}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="100">
                        {c.tags.length === 0 && <Text as="span" tone="subdued">—</Text>}
                        {c.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </InlineStack>
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
