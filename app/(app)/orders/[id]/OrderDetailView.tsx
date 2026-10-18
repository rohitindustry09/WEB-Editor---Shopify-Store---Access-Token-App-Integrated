"use client";

import { Page, Layout, Card, BlockStack, InlineStack, Text, Badge, Box } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { formatMoney } from "@/lib/format";
import type { OrderDetail } from "@/lib/shopify/types";

function financialTone(status: string): "success" | "warning" | "critical" | undefined {
  if (status === "PAID") return "success";
  if (status === "PENDING" || status === "PARTIALLY_PAID") return "warning";
  if (status === "REFUNDED" || status === "VOIDED") return "critical";
  return undefined;
}

function fulfillmentTone(status: string): "success" | "attention" | undefined {
  return status === "FULFILLED" ? "success" : "attention";
}

export function OrderDetailView({
  order,
  error,
}: {
  order: OrderDetail | null;
  error: string | null;
}) {
  if (error || !order) {
    return (
      <Page fullWidth title="Order" backAction={{ content: "Orders", url: "/orders" }}>
        <Layout>
          <Layout.Section>
            <ApiErrorBanner error={error ?? "Something went wrong."} />
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const address = order.shippingAddress;

  return (
    <Page fullWidth title={order.name} backAction={{ content: "Orders", url: "/orders" }} secondaryActions={[{ content: "Fulfill items" }]}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card padding="0">
              <Box padding="400" borderBlockEndWidth="025" borderColor="border">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{order.name}</Text>
                  <InlineStack gap="200">
                    <Badge tone={financialTone(order.displayFinancialStatus)}>{order.displayFinancialStatus}</Badge>
                    <Badge tone={fulfillmentTone(order.displayFulfillmentStatus)}>{order.displayFulfillmentStatus}</Badge>
                  </InlineStack>
                </InlineStack>
              </Box>
              <BlockStack gap="0">
                {order.lineItems.nodes.map((item, i) => (
                  <Box key={i} padding="400" borderBlockEndWidth="025" borderColor="border">
                    <InlineStack align="space-between">
                      <BlockStack gap="0">
                        <Text as="span" fontWeight="medium">{item.title}</Text>
                        <Text as="span" tone="subdued" variant="bodySm">Qty {item.quantity}</Text>
                      </BlockStack>
                      <Text as="span" numeric>
                        {formatMoney({
                          amount: String(Number(item.originalUnitPriceSet.shopMoney.amount) * item.quantity),
                          currencyCode: item.originalUnitPriceSet.shopMoney.currencyCode,
                        })}
                      </Text>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
              <Box padding="400">
                <InlineStack align="space-between">
                  <Text as="span" fontWeight="semibold">Total</Text>
                  <Text as="span" variant="headingMd">{formatMoney(order.totalPriceSet.shopMoney)}</Text>
                </InlineStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Customer</Text>
                <Text as="p">{order.customer?.displayName ?? "—"}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Shipping address</Text>
                {address ? (
                  <Text as="p">
                    {[address.address1, address.city, address.province, address.zip, address.country]
                      .filter(Boolean)
                      .join(", ")}
                  </Text>
                ) : (
                  <Text as="p" tone="subdued">No shipping address.</Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
