"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  DropZone,
  Icon,
  Badge,
  Thumbnail,
  Tag,
  Box,
  Tabs,
} from "@shopify/polaris";
import { FileIcon, XCircleIcon } from "@shopify/polaris-icons";
import { idFromGid } from "@/lib/format";
import { parseSkuColorCsv, formatFileSize } from "@/lib/csvSkuColors";
import { lookupSkuGroupsForRemovalAction, removeColorVariantAction, type RemoveSkuGroup, type RemoveSkuProduct } from "./actions";

type RowStatus = { state: "idle" | "processing" | "removed" | "error"; message?: string };

export function RemoveVariantForm() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<{ sku: string; colorNames: string[] }[]>([]);
  const [groups, setGroups] = useState<RemoveSkuGroup[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, startLookup] = useTransition();
  const [looked, setLooked] = useState(false);

  const [pendingRemovals, setPendingRemovals] = useState<Record<string, string[]>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [applying, setApplying] = useState(false);
  const [filterTab, setFilterTab] = useState(0);

  const resetResults = () => {
    setGroups([]);
    setLooked(false);
    setLookupError(null);
    setPendingRemovals({});
    setRowStatus({});
    setFilterTab(0);
  };

  const handleFile = (picked: File) => {
    setFile(picked);
    const reader = new FileReader();
    reader.onload = () => {
      setRows(parseSkuColorCsv(String(reader.result ?? "")));
      resetResults();
    };
    reader.readAsText(picked);
  };

  const clearFile = () => {
    setFile(null);
    setRows([]);
    resetResults();
  };

  const runLookup = () => {
    setLookupError(null);
    startLookup(async () => {
      const result = await lookupSkuGroupsForRemovalAction(rows);
      if (!result.ok) {
        setLookupError(result.error ?? "Couldn't look up products.");
        return;
      }
      setGroups(result.groups);
      const initial: Record<string, string[]> = {};
      for (const group of result.groups) {
        for (const product of group.products) {
          if (product.matchedNames.length > 0) initial[product.id] = product.matchedNames;
        }
      }
      setPendingRemovals(initial);
      setLooked(true);
      setFilterTab(0);
    });
  };

  const allProducts: RemoveSkuProduct[] = groups.flatMap((g) => g.products);
  const eligibleCount = allProducts.filter((p) => (pendingRemovals[p.id]?.length ?? 0) > 0).length;
  const sharedSkuGroups = groups.filter((g) => g.products.length > 1);
  const sharedSkuProductCount = sharedSkuGroups.reduce((sum, g) => sum + g.products.length, 0);
  const foundGroups = groups.filter((g) => g.products.length > 0);
  const notFoundGroups = groups.filter((g) => g.products.length === 0);

  const filterTabs = [
    { id: "all", content: `All (${groups.length})` },
    { id: "in-store", content: `In the store (${foundGroups.length})` },
    { id: "not-in-store", content: `Not in store (${notFoundGroups.length})` },
  ];
  const visibleGroups = filterTab === 1 ? foundGroups : filterTab === 2 ? notFoundGroups : groups;

  const applyAll = async () => {
    setApplying(true);
    try {
      for (const product of allProducts) {
        const names = pendingRemovals[product.id] ?? [];
        if (names.length === 0) continue;

        setRowStatus((prev) => ({ ...prev, [product.id]: { state: "processing" } }));
        const result = await removeColorVariantAction(product.id, names);
        setRowStatus((prev) => ({
          ...prev,
          [product.id]: result.ok ? { state: "removed" } : { state: "error", message: result.error },
        }));
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <Page
      fullWidth
      title="Bulk remove color variants"
      backAction={{ content: "Color variant checker", url: "/products/color-check" }}
      secondaryActions={[{ content: "Bulk add colors", url: "/products/color-check/bulk" }]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">Upload a CSV to remove colors</Text>
              <Text as="p" tone="subdued">
                Same two columns as bulk add: <b>Product SKU</b>, <b>Color name</b>. Each matching color
                already on the product is removed. If removing them leaves the product with no colors left,
                the whole Color option — and its variants — is removed too, same as clearing the last value
                by hand in Shopify admin.
              </Text>

              {file ? (
                <Card background="bg-surface-secondary">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Icon source={FileIcon} tone="subdued" />
                      <BlockStack gap="0">
                        <Text as="span" fontWeight="medium">{file.name}</Text>
                        <Text as="span" tone="subdued" variant="bodySm">{formatFileSize(file.size)}</Text>
                      </BlockStack>
                    </InlineStack>
                    <Button icon={XCircleIcon} variant="plain" accessibilityLabel="Remove file" onClick={clearFile} />
                  </InlineStack>
                </Card>
              ) : (
                <DropZone
                  accept=".csv,text/csv"
                  type="file"
                  onDrop={(_files, accepted) => accepted[0] && handleFile(accepted[0])}
                >
                  <DropZone.FileUpload actionTitle="Add file" actionHint="or drop a CSV to upload" />
                </DropZone>
              )}

              {rows.length > 0 && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" tone="subdued">
                    {rows.length} SKU{rows.length === 1 ? "" : "s"} parsed
                  </Text>
                  <Button variant="primary" loading={looking} onClick={runLookup}>
                    Look up products
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {lookupError && (
          <Layout.Section>
            <Banner tone="critical"><p>{lookupError}</p></Banner>
          </Layout.Section>
        )}

        {looked && (
          <Layout.Section>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="span" tone="subdued">
                    {groups.length} SKU group{groups.length === 1 ? "" : "s"} · {allProducts.length} product
                    {allProducts.length === 1 ? "" : "s"} matched
                  </Text>
                  <Text as="span" tone="subdued" variant="bodySm">
                    {allProducts.length} matched = {foundGroups.length} SKU{foundGroups.length === 1 ? "" : "s"} found
                    in store{sharedSkuGroups.length > 0 && ` (${sharedSkuGroups.length} of them sharing a SKU across ${sharedSkuProductCount} products)`}
                  </Text>
                  {notFoundGroups.length > 0 && (
                    <Text as="span" tone="caution" variant="bodySm">
                      {notFoundGroups.length} SKU{notFoundGroups.length === 1 ? "" : "s"} not found in the store
                    </Text>
                  )}
                </BlockStack>
                <Button tone="critical" variant="primary" loading={applying} disabled={eligibleCount === 0} onClick={applyAll}>
                  {`Remove from all (${eligibleCount})`}
                </Button>
              </InlineStack>

              <Tabs tabs={filterTabs} selected={filterTab} onSelect={setFilterTab} />

              {visibleGroups.map((group) => (
                <Card key={group.sku} padding="0">
                  <Box padding="300" borderBlockEndWidth="025" borderColor="border" background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">SKU {group.sku}</Text>
                      {group.products.length > 1 && (
                        <Badge tone="attention">{`${group.products.length} products share this SKU`}</Badge>
                      )}
                    </InlineStack>
                  </Box>
                  <BlockStack gap="0">
                    {group.products.length === 0 ? (
                      <Box padding="400">
                        <Text as="p" tone="subdued">No product found with this SKU.</Text>
                      </Box>
                    ) : (
                      group.products.map((product) => {
                        const queued = pendingRemovals[product.id] ?? [];
                        const status = rowStatus[product.id];
                        return (
                          <Box key={product.id} padding="300" borderBlockEndWidth="025" borderColor="border">
                            <BlockStack gap="200">
                              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                                <InlineStack gap="300" blockAlign="center" wrap={false}>
                                  <Thumbnail source={product.imageUrl ?? ""} alt={product.title} size="small" />
                                  <Box minWidth="0">
                                    <BlockStack gap="050">
                                      <Link href={`/products/${idFromGid(product.id)}`}>
                                        <Text as="span" fontWeight="semibold" truncate>{product.title}</Text>
                                      </Link>
                                      <Text as="span" tone="subdued" variant="bodySm">
                                        {product.categoryName ?? "No category set"}
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                </InlineStack>
                                <InlineStack gap="200" blockAlign="center">
                                  {status?.state === "processing" && <Badge tone="info">Processing…</Badge>}
                                  {status?.state === "removed" && <Badge tone="success">Removed</Badge>}
                                  {status?.state === "error" && <Badge tone="critical">Error</Badge>}
                                </InlineStack>
                              </InlineStack>

                              {status?.state === "error" && (
                                <Text as="p" tone="critical" variant="bodySm">{status.message}</Text>
                              )}

                              <BlockStack gap="100">
                                <Text as="span" tone="subdued" variant="bodySm">Current colors</Text>
                                {product.existingColors.length === 0 ? (
                                  <Text as="span" tone="subdued" variant="bodySm">No Color option on this product.</Text>
                                ) : (
                                  <InlineStack gap="150" wrap>
                                    {product.existingColors.map((c) => {
                                      const queuedForRemoval = queued.includes(c.name);
                                      return (
                                        <Tag
                                          key={c.id}
                                          onRemove={
                                            queuedForRemoval
                                              ? () =>
                                                  setPendingRemovals((prev) => ({
                                                    ...prev,
                                                    [product.id]: (prev[product.id] ?? []).filter((n) => n !== c.name),
                                                  }))
                                              : undefined
                                          }
                                        >
                                          <span style={queuedForRemoval ? { textDecoration: "line-through" } : undefined}>
                                            {c.name}
                                          </span>
                                        </Tag>
                                      );
                                    })}
                                  </InlineStack>
                                )}
                              </BlockStack>

                              {product.notOnProduct.length > 0 && (
                                <Banner tone="warning">
                                  <p>
                                    Not currently on this product: {product.notOnProduct.join(", ")} — nothing to
                                    remove for {product.notOnProduct.length === 1 ? "it" : "them"}.
                                  </p>
                                </Banner>
                              )}

                              {product.existingColors.length > 0 && (
                                <InlineStack gap="200" blockAlign="center" wrap>
                                  {product.existingColors
                                    .filter((c) => !queued.includes(c.name))
                                    .map((c) => (
                                      <Button
                                        key={c.id}
                                        size="slim"
                                        tone="critical"
                                        onClick={() =>
                                          setPendingRemovals((prev) => ({
                                            ...prev,
                                            [product.id]: [...(prev[product.id] ?? []), c.name],
                                          }))
                                        }
                                      >
                                        {`− ${c.name}`}
                                      </Button>
                                    ))}
                                </InlineStack>
                              )}
                            </BlockStack>
                          </Box>
                        );
                      })
                    )}
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
