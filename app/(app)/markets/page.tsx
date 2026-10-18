"use client";

import { Page, Layout, Card, IndexTable, Badge, Banner } from "@shopify/polaris";
import { markets } from "@/lib/mock-data";

export default function MarketsPage() {
  return (
    <Page fullWidth title="Markets">
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Sample data">
            <p>Markets aren&apos;t wired to Shopify yet — this view shows sample data.</p>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "market", plural: "markets" }}
              itemCount={markets.length}
              selectable={false}
              headings={[{ title: "Market" }, { title: "Region" }, { title: "Currency" }, { title: "Status" }]}
            >
              {markets.map((m, index) => (
                <IndexTable.Row id={m.id} key={m.id} position={index}>
                  <IndexTable.Cell>{m.name}</IndexTable.Cell>
                  <IndexTable.Cell>{m.region}</IndexTable.Cell>
                  <IndexTable.Cell>{m.currency}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={m.status === "Active" ? "success" : undefined}>{m.status}</Badge></IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
