"use client";

import { Page, Layout, Card, BlockStack, InlineStack, Text, Box, Thumbnail } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { SalesChart } from "@/components/analytics/SalesChart";
import { formatMoney } from "@/lib/format";

export interface AnalyticsViewProps {
  error: string | null;
  totalRevenue: number;
  avgOrderValue: number;
  currencyCode: string;
  salesSeries: { label: string; value: number }[];
  topProducts: { title: string; revenue: number; image: string | null }[];
}

export function AnalyticsView({
  error,
  totalRevenue,
  avgOrderValue,
  currencyCode,
  salesSeries,
  topProducts,
}: AnalyticsViewProps) {
  const maxRevenue = topProducts[0]?.revenue ?? 1;

  return (
    <Page fullWidth title="Analytics">
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Box minWidth="200px">
              <Card>
                <BlockStack gap="150">
                  <Text as="p" tone="subdued" variant="bodySm">Revenue, last 7 days seen</Text>
                  <Text as="p" variant="headingLg">{formatMoney({ amount: String(totalRevenue), currencyCode })}</Text>
                </BlockStack>
              </Card>
            </Box>
            <Box minWidth="200px">
              <Card>
                <BlockStack gap="150">
                  <Text as="p" tone="subdued" variant="bodySm">Average order value</Text>
                  <Text as="p" variant="headingLg">{formatMoney({ amount: avgOrderValue.toFixed(2), currencyCode })}</Text>
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Sales over time</Text>
              {salesSeries.length >= 2 ? (
                <SalesChart data={salesSeries} />
              ) : (
                <Text as="p" tone="subdued">Not enough order history yet to chart.</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <Text as="h2" variant="headingMd">Top products by revenue</Text>
            </Box>
            <BlockStack gap="0">
              {topProducts.length === 0 && (
                <Box padding="400"><Text as="p" tone="subdued">No sales yet.</Text></Box>
              )}
              {topProducts.map((p) => (
                <Box key={p.title} padding="300" borderBlockEndWidth="025" borderColor="border">
                  <InlineStack gap="300" blockAlign="center">
                    <Thumbnail source={p.image ?? ""} alt={p.title} size="small" />
                    <div style={{ flex: 1 }}>
                      <Text as="span" truncate>{p.title}</Text>
                      <div style={{ height: "6px", background: "var(--p-color-bg-surface-secondary)", borderRadius: "999px", marginTop: "4px" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${(p.revenue / maxRevenue) * 100}%`,
                            background: "var(--p-color-bg-fill-brand)",
                            borderRadius: "999px",
                          }}
                        />
                      </div>
                    </div>
                    <Text as="span" numeric fontWeight="medium">
                      {formatMoney({ amount: String(p.revenue), currencyCode })}
                    </Text>
                  </InlineStack>
                </Box>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
