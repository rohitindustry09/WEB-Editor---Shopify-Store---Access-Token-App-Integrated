"use client";

import { Page, Layout, Card, IndexTable, Text, InlineStack, Box } from "@shopify/polaris";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ResourceEmptyState } from "@/components/ui/ResourceEmptyState";
import { CursorPagination } from "@/components/ui/CursorPagination";
import type { MetaobjectDefinitionDetail, MetaobjectEntry } from "@/lib/shopify/metaobjects";

const PAGE_SIZE = 50;

export function EntriesView({
  definition,
  entries,
  referenceLabels,
  page,
  pageInfo,
  error,
}: {
  definition: MetaobjectDefinitionDetail | null;
  entries: MetaobjectEntry[];
  referenceLabels: Record<string, string>;
  page: number;
  pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null };
  error: string | null;
}) {
  if (error || !definition) {
    return (
      <Page fullWidth title="Metaobject" backAction={{ content: "Metaobjects", url: "/content/metaobjects" }}>
        <Layout>
          <Layout.Section>
            <ApiErrorBanner error={error ?? "Definition not found."} />
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const displayFields = definition.fieldDefinitions.slice(0, 5);
  const isColorDefinition = definition.fieldDefinitions.some((f) => f.typeName === "color");

  const renderValue = (fieldKey: string, typeName: string, entry: MetaobjectEntry) => {
    const raw = entry.fields.find((f) => f.key === fieldKey)?.value;
    if (!raw) return <Text as="span" tone="subdued">—</Text>;

    if (typeName === "color") {
      return (
        <InlineStack gap="150" blockAlign="center">
          <div style={{ width: 16, height: 16, borderRadius: 4, background: raw, border: "1px solid var(--p-color-border)" }} />
          <Text as="span" tone="subdued">{raw}</Text>
        </InlineStack>
      );
    }

    if (typeName === "metaobject_reference" || typeName === "product_taxonomy_value_reference") {
      return <Text as="span">{referenceLabels[raw] ?? raw}</Text>;
    }

    if (typeName === "list.metaobject_reference" || typeName === "list.product_taxonomy_value_reference") {
      try {
        const ids = JSON.parse(raw) as string[];
        return <Text as="span">{ids.map((id) => referenceLabels[id] ?? id).join(", ")}</Text>;
      } catch {
        return <Text as="span" tone="subdued">—</Text>;
      }
    }

    return <Text as="span">{raw}</Text>;
  };

  return (
    <Page
      fullWidth
      title={definition.name}
      backAction={{ content: "Metaobjects", url: "/content/metaobjects" }}
      primaryAction={{ content: "Add entry", url: `/content/metaobjects/${encodeURIComponent(definition.type)}/new` }}
      secondaryActions={
        isColorDefinition
          ? [{ content: "Bulk add colors", url: `/content/metaobjects/${encodeURIComponent(definition.type)}/bulk` }]
          : []
      }
    >
      <Layout>
        <Layout.Section>
          {entries.length === 0 ? (
            <ResourceEmptyState heading="No entries yet" action={{ content: "Add entry", url: `/content/metaobjects/${encodeURIComponent(definition.type)}/new` }}>
              <p>Entries you create will show up here.</p>
            </ResourceEmptyState>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "entry", plural: "entries" }}
                itemCount={entries.length}
                selectable={false}
                headings={[
                  { title: "Display name" },
                  ...displayFields.filter((f) => f.typeName !== "single_line_text_field" || displayFields[0].key !== f.key).map((f) => ({ title: f.name })),
                  { title: "Updated" },
                ]}
              >
                {entries.map((entry, index) => (
                  <IndexTable.Row id={entry.id} key={entry.id} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">{entry.displayName}</Text>
                    </IndexTable.Cell>
                    {displayFields
                      .filter((f) => f.typeName !== "single_line_text_field" || displayFields[0].key !== f.key)
                      .map((f) => (
                        <IndexTable.Cell key={f.key}>{renderValue(f.key, f.typeName, entry)}</IndexTable.Cell>
                      ))}
                    <IndexTable.Cell>{new Date(entry.updatedAt).toLocaleDateString()}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
              <Box padding="300" borderBlockStartWidth="025" borderColor="border">
                <CursorPagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  count={entries.length}
                  hasNextPage={pageInfo.hasNextPage}
                  hasPreviousPage={pageInfo.hasPreviousPage}
                  startCursor={pageInfo.startCursor}
                  endCursor={pageInfo.endCursor}
                />
              </Box>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
