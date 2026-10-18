"use client";

import { Page, Layout, Card, IndexTable, Badge, Banner, Text } from "@shopify/polaris";

const transfers = [
  { id: "TR-1004", from: "Chennai Fulfilment Center", to: "Hyderabad Warehouse", items: 40, status: "In transit", eta: "2026-08-22" },
  { id: "TR-1003", from: "Hyderabad Warehouse", to: "Bengaluru Hub", items: 18, status: "Received", eta: "2026-08-15" },
  { id: "TR-1002", from: "Bengaluru Hub", to: "Chennai Fulfilment Center", items: 25, status: "Draft", eta: "—" },
];

function tone(status: string): "success" | "info" | undefined {
  if (status === "Received") return "success";
  if (status === "In transit") return "info";
  return undefined;
}

export default function TransfersPage() {
  return (
    <Page fullWidth title="Transfers" backAction={{ content: "Products", url: "/products" }} primaryAction={{ content: "Create transfer" }}>
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Sample data">
            <p>Inventory transfers aren&apos;t wired to Shopify yet — this view shows sample data.</p>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "transfer", plural: "transfers" }}
              itemCount={transfers.length}
              selectable={false}
              headings={[{ title: "Transfer" }, { title: "From" }, { title: "To" }, { title: "Items" }, { title: "Status" }, { title: "ETA" }]}
            >
              {transfers.map((t, index) => (
                <IndexTable.Row id={t.id} key={t.id} position={index}>
                  <IndexTable.Cell><Text as="span" fontWeight="semibold">{t.id}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{t.from}</IndexTable.Cell>
                  <IndexTable.Cell>{t.to}</IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" numeric>{t.items}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={tone(t.status)}>{t.status}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>{t.eta}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
