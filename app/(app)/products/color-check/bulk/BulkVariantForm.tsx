"use client";

import { StatTile } from "@/components/ui/StatTile";

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
import { ColorVariantPicker, type ColorLibraryEntry } from "@/components/products/ColorVariantPicker";
import { ColorOptionBadges } from "@/components/products/ColorOptionBadges";
import { parseSkuColorCsv, formatFileSize, type SkuColorCsvRow } from "@/lib/csvSkuColors";
import { lookupSkuGroupsAction, type BulkSkuGroup, type BulkSkuProduct } from "./actions";
import { addColorVariantAction } from "../actions";

type CsvRow = SkuColorCsvRow;

type RowStatus = { state: "idle" | "processing" | "added" | "skipped" | "error"; message?: string };


export function BulkVariantForm({
  colorLibrary,
  colorLibraryError,
}: {
  colorLibrary: ColorLibraryEntry[];
  colorLibraryError: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [groups, setGroups] = useState<BulkSkuGroup[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, startLookup] = useTransition();
  const [looked, setLooked] = useState(false);

  const [pendingColors, setPendingColors] = useState<Record<string, ColorLibraryEntry[]>>({});
  const [pickerProductId, setPickerProductId] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [applying, setApplying] = useState(false);
  const [filterTab, setFilterTab] = useState(0);

  const handleFile = (picked: File) => {
    setFile(picked);
    const reader = new FileReader();
    reader.onload = () => {
      setRows(parseSkuColorCsv(String(reader.result ?? "")));
      setGroups([]);
      setLooked(false);
      setLookupError(null);
      setPendingColors({});
      setRowStatus({});
      setFilterTab(0);
    };
    reader.readAsText(picked);
  };

  const clearFile = () => {
    setFile(null);
    setRows([]);
    setGroups([]);
    setLooked(false);
    setLookupError(null);
    setPendingColors({});
    setRowStatus({});
    setFilterTab(0);
  };

  const runLookup = () => {
    setLookupError(null);
    startLookup(async () => {
      const result = await lookupSkuGroupsAction(rows, colorLibrary);
      if (!result.ok) {
        setLookupError(result.error ?? "Couldn't look up products.");
        return;
      }
      setGroups(result.groups);
      const initial: Record<string, ColorLibraryEntry[]> = {};
      for (const group of result.groups) {
        for (const product of group.products) {
          if (product.resolvedColors.length > 0) initial[product.id] = product.resolvedColors;
        }
      }
      setPendingColors(initial);
      setLooked(true);
      setFilterTab(0);
    });
  };

  const needsUpdate = (product: BulkSkuProduct) => {
    const colors = pendingColors[product.id] ?? [];
    if (!product.hasColor || colors.length === 0) return false;
    const existingNames = new Set(product.existingColors.map((c) => c.name.trim().toLowerCase()));
    return colors.some((c) => !existingNames.has(c.name.trim().toLowerCase()));
  };

  const allProducts: BulkSkuProduct[] = groups.flatMap((g) => g.products);
  const queuedCount = allProducts.filter((p) => p.hasColor && (pendingColors[p.id]?.length ?? 0) > 0).length;
  const eligibleCount = allProducts.filter(needsUpdate).length;
  const alreadyUpToDateCount = queuedCount - eligibleCount;
  const sharedSkuGroups = groups.filter((g) => g.products.length > 1);
  const sharedSkuProductCount = sharedSkuGroups.reduce((sum, g) => sum + g.products.length, 0);
  const foundGroups = groups.filter((g) => g.products.length > 0);
  const notFoundGroups = groups.filter((g) => g.products.length === 0);

  const filterTabs = [
    { id: "all", content: `All (${groups.length})` },
    { id: "in-store", content: `In the store (${foundGroups.length})` },
    { id: "not-in-store", content: `Not in store (${notFoundGroups.length})` },
  ];
  const visibleGroups =
    filterTab === 1 ? foundGroups : filterTab === 2 ? notFoundGroups : groups;

  const applyAll = async () => {
    setApplying(true);
    try {
      for (const product of allProducts) {
        const colors = pendingColors[product.id] ?? [];
        if (!product.hasColor || colors.length === 0) continue;

        const existingNames = new Set(product.existingColors.map((c) => c.name.trim().toLowerCase()));
        const allAlreadyPresent = colors.every((c) => existingNames.has(c.name.trim().toLowerCase()));
        if (allAlreadyPresent) {
          setRowStatus((prev) => ({ ...prev, [product.id]: { state: "skipped", message: "Already added" } }));
          continue;
        }

        setRowStatus((prev) => ({ ...prev, [product.id]: { state: "processing" } }));
        const result = await addColorVariantAction(
          product.id,
          colors.map((c) => ({ id: c.id, name: c.name })),
        );
        if (!result.ok) {
          setRowStatus((prev) => ({ ...prev, [product.id]: { state: "error", message: result.error } }));
          continue;
        }
        const fullySkipped = (result.alreadyPresent?.length ?? 0) === colors.length;
        setRowStatus((prev) => ({
          ...prev,
          [product.id]: fullySkipped
            ? { state: "skipped", message: "Already added" }
            : { state: "added" },
        }));
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <Page
      fullWidth
      title="Bulk apply color variants"
      backAction={{ content: "Color variant checker", url: "/products/color-check" }}
      secondaryActions={[{ content: "Bulk remove colors", url: "/products/color-check/bulk/remove" }]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">Upload a CSV</Text>
              <Text as="p" tone="subdued">
                Two columns, no header required: <b>Product SKU</b>, <b>Color name</b>. Multiple rows for
                the same SKU add multiple colors. Products sharing a SKU are grouped together below.
              </Text>

              {colorLibraryError && (
                <Banner tone="warning" title="Color library unavailable">
                  <p>{colorLibraryError}</p>
                </Banner>
              )}

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
              <Card>
                <BlockStack gap="400">
                  <div className="stat-grid">
                    <StatTile value={groups.length} label="SKUs looked up" tone="neutral" />
                    <StatTile value={allProducts.length} label="Products matched" tone="info" />
                    <StatTile value={foundGroups.length} label="SKUs found in store" tone="success" />
                    <StatTile value={notFoundGroups.length} label="SKUs not found" tone="critical" />
                    <StatTile value={sharedSkuProductCount} label="Products on shared SKUs" tone="caution" />
                    <StatTile value={alreadyUpToDateCount} label="Already up to date" tone="neutral" />
                  </div>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued" variant="bodySm">
                      {eligibleCount} product{eligibleCount === 1 ? "" : "s"} will actually change when you apply.
                    </Text>
                    <Button variant="primary" loading={applying} disabled={eligibleCount === 0} onClick={applyAll}>
                      {`Apply changes to all (${eligibleCount})`}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

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
                        const selected = pendingColors[product.id] ?? [];
                        const status = rowStatus[product.id];
                        const alreadyQueued = !status && product.hasColor && selected.length > 0 && !needsUpdate(product);
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
                                <BlockStack gap="100" align="end">
                                  <InlineStack gap="200" blockAlign="center" align="end">
                                    {status?.state === "processing" && <Badge tone="info">Processing…</Badge>}
                                    {status?.state === "added" && <Badge tone="success">Added</Badge>}
                                    {status?.state === "skipped" && <Badge tone="info">Skip — already done</Badge>}
                                    {status?.state === "error" && <Badge tone="critical">Error</Badge>}
                                    {product.categoryError ? (
                                      <Badge tone="critical">Couldn&apos;t check</Badge>
                                    ) : product.hasColor === null ? (
                                      <Badge>No category</Badge>
                                    ) : (
                                      <Badge tone={product.hasColor ? "success" : "critical"}>
                                        {product.hasColor ? "Color available" : "Color not available"}
                                      </Badge>
                                    )}
                                  </InlineStack>
                                  {alreadyQueued && (
                                    <InlineStack align="end">
                                      <Badge>Skipped</Badge>
                                    </InlineStack>
                                  )}
                                </BlockStack>
                              </InlineStack>

                              {status?.state === "error" && (
                                <Text as="p" tone="critical" variant="bodySm">{status.message}</Text>
                              )}

                              <ColorOptionBadges values={product.existingColors} />

                              {product.unresolvedNames.length > 0 && (
                                <Banner tone="warning">
                                  <p>
                                    Not found in the Color library: {product.unresolvedNames.join(", ")} — add the
                                    right entry manually below.
                                  </p>
                                </Banner>
                              )}

                              {product.hasColor && (
                                <InlineStack gap="200" blockAlign="center" wrap>
                                  {selected.map((c) => (
                                    <Tag
                                      key={c.id}
                                      onRemove={() =>
                                        setPendingColors((prev) => ({
                                          ...prev,
                                          [product.id]: (prev[product.id] ?? []).filter((x) => x.id !== c.id),
                                        }))
                                      }
                                    >
                                      {c.name}
                                    </Tag>
                                  ))}
                                  <Button size="slim" onClick={() => setPickerProductId(product.id)}>
                                    + Add colors manually
                                  </Button>
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

      <ColorVariantPicker
        open={pickerProductId !== null}
        onClose={() => setPickerProductId(null)}
        library={colorLibrary}
        selected={pickerProductId ? (pendingColors[pickerProductId] ?? []) : []}
        onChange={(next) => {
          if (!pickerProductId) return;
          setPendingColors((prev) => ({ ...prev, [pickerProductId]: next }));
        }}
      />
    </Page>
  );
}
