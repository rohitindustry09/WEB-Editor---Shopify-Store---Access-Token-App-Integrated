"use client";

import { Page, Layout, Card, IndexTable, Text, Badge, Banner } from "@shopify/polaris";
import { discounts } from "@/lib/mock-data";

function tone(status: string): "success" | "info" | undefined {
  if (status === "Active") return "success";
  if (status === "Scheduled") return "info";
  return undefined;
}

export default function DiscountsPage() {
  return (
    <Page fullWidth title="Discounts" primaryAction={{ content: "Create discount" }}>
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Sample data">
            <p>Discount codes aren&apos;t wired to Shopify yet — this view shows sample data.</p>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "discount", plural: "discounts" }}
              itemCount={discounts.length}
              selectable={false}
              headings={[{ title: "Code" }, { title: "Type" }, { title: "Value" }, { title: "Status" }, { title: "Used" }]}
            >
              {discounts.map((d, index) => (
                <IndexTable.Row id={d.id} key={d.id} position={index}>
                  <IndexTable.Cell><Text as="span" fontWeight="semibold">{d.code}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{d.type}</IndexTable.Cell>
                  <IndexTable.Cell>{d.value}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={tone(d.status)}>{d.status}</Badge></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" numeric>{d.used}</Text></IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
