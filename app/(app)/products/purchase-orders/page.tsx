"use client";

import { Page, Layout, Card, IndexTable, Badge, Banner, Text } from "@shopify/polaris";
import { formatINR } from "@/lib/mock-data";

const purchaseOrders = [
  { id: "PO-2031", vendor: "The Brasstown Foundry", items: 120, cost: 84500, status: "Ordered", expected: "2026-08-28" },
  { id: "PO-2030", vendor: "Moradabad Brassworks", items: 60, cost: 41200, status: "Received", expected: "2026-08-10" },
  { id: "PO-2029", vendor: "The Brasstown Foundry", items: 90, cost: 63800, status: "Draft", expected: "—" },
];

function tone(status: string): "success" | "info" | undefined {
  if (status === "Received") return "success";
  if (status === "Ordered") return "info";
  return undefined;
}

export default function PurchaseOrdersPage() {
  return (
    <Page fullWidth title="Purchase orders" backAction={{ content: "Products", url: "/products" }} primaryAction={{ content: "Create purchase order" }}>
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Sample data">
            <p>Purchase orders aren&apos;t wired to Shopify yet — this view shows sample data.</p>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "purchase order", plural: "purchase orders" }}
              itemCount={purchaseOrders.length}
              selectable={false}
              headings={[{ title: "PO" }, { title: "Vendor" }, { title: "Items" }, { title: "Cost" }, { title: "Status" }, { title: "Expected" }]}
            >
              {purchaseOrders.map((po, index) => (
                <IndexTable.Row id={po.id} key={po.id} position={index}>
                  <IndexTable.Cell><Text as="span" fontWeight="semibold">{po.id}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{po.vendor}</IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" numeric>{po.items}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" numeric>{formatINR(po.cost)}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={tone(po.status)}>{po.status}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>{po.expected}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
