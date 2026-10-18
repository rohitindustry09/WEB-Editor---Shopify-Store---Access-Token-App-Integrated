"use client";

import Link from "next/link";
import { Page, Layout, Card, IndexTable, Text, Badge, ButtonGroup, Button } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import { formatMoney, idFromGid } from "@/lib/format";
import type { OrderListItem } from "@/lib/shopify/types";

const FILTERS = ["all", "unfulfilled", "unpaid", "closed"] as const;

function financialTone(status: string): "success" | "warning" | "critical" | undefined {
  if (status === "PAID") return "success";
  if (status === "PENDING" || status === "PARTIALLY_PAID") return "warning";
  if (status === "REFUNDED" || status === "VOIDED") return "critical";
  return undefined;
}

function fulfillmentTone(status: string): "success" | "attention" | undefined {
  return status === "FULFILLED" ? "success" : "attention";
}

export function OrdersView({
  orders,
  filter,
  error,
}: {
  orders: OrderListItem[];
  filter: (typeof FILTERS)[number];
  error: string | null;
}) {
  return (
    <Page fullWidth title="Orders" secondaryActions={[{ content: "Export" }]}>
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        <Layout.Section>
          <div style={{ marginBottom: "0.75rem" }}>
            <ButtonGroup variant="segmented">
              {FILTERS.map((f) => (
                <Button key={f} url={`/orders?filter=${f}`} pressed={filter === f}>
                  {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
                </Button>
              ))}
            </ButtonGroup>
          </div>
          {!error && orders.length === 0 ? (
            <ResourceEmptyState heading="No orders in this view">
              <p>Orders will show up here as customers check out.</p>
            </ResourceEmptyState>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "order", plural: "orders" }}
                itemCount={orders.length}
                selectable={false}
                headings={[
                  { title: "Order" },
                  { title: "Date" },
                  { title: "Customer" },
                  { title: "Payment" },
                  { title: "Fulfillment" },
                  { title: "Total" },
                ]}
              >
                {orders.map((order, index) => (
                  <IndexTable.Row id={order.id} key={order.id} position={index}>
                    <IndexTable.Cell>
                      <Link href={`/orders/${idFromGid(order.id)}`}>
                        <Text as="span" fontWeight="semibold">{order.name}</Text>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{new Date(order.createdAt).toLocaleDateString()}</IndexTable.Cell>
                    <IndexTable.Cell>{order.customer?.displayName ?? "—"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={financialTone(order.displayFinancialStatus)}>{order.displayFinancialStatus}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={fulfillmentTone(order.displayFulfillmentStatus)}>{order.displayFulfillmentStatus}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" numeric>{formatMoney(order.totalPriceSet.shopMoney)}</Text>
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
