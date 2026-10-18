"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, IndexTable, Text, TextField, Banner, InlineStack } from "@shopify/polaris";
import { adjustInventoryAction } from "@/app/(app)/products/inventory/actions";
import type { InventoryVariantNode } from "@/lib/shopify/types";

function levelFor(row: InventoryVariantNode, name: string): number {
  let total = 0;
  for (const level of row.inventoryItem.inventoryLevels.nodes) {
    total += level.quantities.find((q) => q.name === name)?.quantity ?? 0;
  }
  return total;
}

function primaryLocation(row: InventoryVariantNode) {
  return row.inventoryItem.inventoryLevels.nodes[0]?.location ?? null;
}

export function InventoryTable({ rows }: { rows: InventoryVariantNode[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const commit = (row: InventoryVariantNode) => {
    const draft = drafts[row.id];
    if (draft === undefined) return;
    const nextValue = Number(draft);
    const current = levelFor(row, "available");
    if (Number.isNaN(nextValue) || nextValue === current) return;
    const location = primaryLocation(row);
    if (!location) return;

    startTransition(async () => {
      const result = await adjustInventoryAction(
        row.inventoryItem.id,
        location.id,
        nextValue - current,
      );
      if (!result.ok) setError(result.error ?? "Couldn't adjust inventory.");
      else {
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        router.refresh();
      }
    });
  };

  return (
    <Card padding="0">
      {error && (
        <div style={{ padding: "0.75rem" }}>
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        </div>
      )}
      <IndexTable
        resourceName={{ singular: "variant", plural: "variants" }}
        itemCount={rows.length}
        selectable={false}
        headings={[
          { title: "Variant" },
          { title: "SKU" },
          { title: "Location" },
          { title: "Available" },
          { title: "Committed" },
        ]}
      >
        {rows.map((row, index) => {
          const location = primaryLocation(row);
          const available = levelFor(row, "available");
          const committed = levelFor(row, "committed");
          const value = drafts[row.id] ?? String(available);

          return (
            <IndexTable.Row id={row.id} key={row.id} position={index}>
              <IndexTable.Cell>
                <Text as="span" truncate>{row.displayName}</Text>
              </IndexTable.Cell>
              <IndexTable.Cell>{row.sku || "—"}</IndexTable.Cell>
              <IndexTable.Cell>{location?.name ?? "—"}</IndexTable.Cell>
              <IndexTable.Cell>
                <InlineStack gap="100" blockAlign="center">
                  <div style={{ width: "90px" }} onClick={(e) => e.stopPropagation()}>
                    <TextField
                      label="Available"
                      labelHidden
                      type="number"
                      autoComplete="off"
                      value={value}
                      onChange={(v) => setDrafts((prev) => ({ ...prev, [row.id]: v }))}
                      onBlur={() => commit(row)}
                      disabled={pending || !location}
                    />
                  </div>
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" numeric>{committed}</Text>
              </IndexTable.Cell>
            </IndexTable.Row>
          );
        })}
      </IndexTable>
    </Card>
  );
}
