"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Page, Layout, Card, IndexTable, Text } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import type { MenuSummary } from "@/lib/shopify/menus";
import { AddMenuModal } from "./AddMenuModal";

export function MenusView({ menus, error }: { menus: MenuSummary[]; error: string | null }) {
  const router = useRouter();
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  return (
    <Page
      fullWidth
      title="Menus"
      backAction={{ content: "Content", url: "/content" }}
      primaryAction={{ content: "Add menu", onAction: () => setAddMenuOpen(true) }}
    >
      <AddMenuModal open={addMenuOpen} onClose={() => setAddMenuOpen(false)} onCreated={() => router.refresh()} />
      <Layout>
        {error && (
          <Layout.Section>
            <ApiErrorBanner error={error} />
          </Layout.Section>
        )}
        <Layout.Section>
          {!error && menus.length === 0 ? (
            <ResourceEmptyState heading="No menus yet" action={{ content: "Add menu", onAction: () => setAddMenuOpen(true) }}>
              <p>Navigation menus for your storefront will show up here.</p>
            </ResourceEmptyState>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "menu", plural: "menus" }}
                itemCount={menus.length}
                selectable={false}
                headings={[{ title: "Title" }, { title: "Handle" }, { title: "Items" }]}
              >
                {menus.map((m, index) => (
                  <IndexTable.Row id={m.id} key={m.id} position={index}>
                    <IndexTable.Cell><Text as="span" fontWeight="semibold">{m.title}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" tone="subdued">{m.handle}</Text></IndexTable.Cell>
                    <IndexTable.Cell><Text as="span" numeric>{m.items.length}</Text></IndexTable.Cell>
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
