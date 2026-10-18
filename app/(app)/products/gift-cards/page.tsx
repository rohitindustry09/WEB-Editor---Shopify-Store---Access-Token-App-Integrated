"use client";

import { Page, Layout, Card, IndexTable, Badge, Banner, Text } from "@shopify/polaris";
import { formatINR } from "@/lib/mock-data";

const giftCards = [
  { code: "BT-GC-9F21", balance: 2000, initial: 2000, status: "Active", customer: "Ananya Rao" },
  { code: "BT-GC-4A08", balance: 0, initial: 1000, status: "Expired", customer: "Karthik Iyer" },
  { code: "BT-GC-77C3", balance: 850, initial: 1500, status: "Active", customer: "Divya Krishnan" },
];

export default function GiftCardsPage() {
  return (
    <Page fullWidth title="Gift cards" backAction={{ content: "Products", url: "/products" }} primaryAction={{ content: "Issue gift card" }}>
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Sample data">
            <p>Gift cards aren&apos;t wired to Shopify yet — this view shows sample data.</p>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "gift card", plural: "gift cards" }}
              itemCount={giftCards.length}
              selectable={false}
              headings={[{ title: "Code" }, { title: "Customer" }, { title: "Balance" }, { title: "Initial value" }, { title: "Status" }]}
            >
              {giftCards.map((gc, index) => (
                <IndexTable.Row id={gc.code} key={gc.code} position={index}>
                  <IndexTable.Cell><Text as="span" fontWeight="semibold">{gc.code}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{gc.customer}</IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" numeric>{formatINR(gc.balance)}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" numeric>{formatINR(gc.initial)}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={gc.status === "Active" ? "success" : undefined}>{gc.status}</Badge></IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
