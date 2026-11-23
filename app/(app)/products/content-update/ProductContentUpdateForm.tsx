"use client";

import { StatTile } from "@/components/ui/StatTile";

import { useRef, useState, useTransition } from "react";
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
  Badge,
  Thumbnail,
  Checkbox,
  Box,
  Tabs,
  Spinner,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { idFromGid } from "@/lib/format";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import {
  parseProductContentCsv,
  mapProductContentRows,
  UPDATABLE_FIELDS,
  type UpdatableField,
  type ProductContentCsvRow,
} from "@/lib/csvProductContent";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ProductContentMappingPanel } from "./ProductContentMappingPanel";
import {
  lookupProductContentGroupsAction,
  applyProductContentUpdateAction,
  type ProductContentGroup,
  type ProductContentMatch,
} from "./actions";

type RowStatus = { state: "idle" | "pending" | "done" | "skipped" | "error"; message?: string };

const APPLY_CONCURRENCY = 5;


const STATUS_TONE: Record<ProductContentMatch["status"], "success" | "info" | "warning"> = {
  ACTIVE: "success",
  DRAFT: "info",
  ARCHIVED: "warning",
};

function truncate(value: string, max = 90): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Whether every mapped field's target value already matches what the product currently has — normalized so trivial whitespace/case differences don't force a needless write. */
function alreadyMatches(product: ProductContentMatch, fields: Partial<Record<UpdatableField, string>>): boolean {
  return (Object.entries(fields) as [UpdatableField, string][]).every(([key, value]) => {
    if (key === "tags") {
      const targetTags = new Set(
        value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      );
      const currentTags = new Set(product.current.tags.map((t) => t.trim().toLowerCase()));
      return targetTags.size === currentTags.size && [...targetTags].every((t) => currentTags.has(t));
    }
    const current =
      key === "title"
        ? product.current.title
        : key === "descriptionHtml"
          ? product.current.descriptionHtml
          : key === "seoTitle"
            ? (product.current.seoTitle ?? "")
            : (product.current.seoDescription ?? "");
    return current.trim() === value.trim();
  });
}

const FIELD_LABEL: Record<UpdatableField, string> = Object.fromEntries(
  UPDATABLE_FIELDS.map((f) => [f.key, f.label]),
) as Record<UpdatableField, string>;

export function ProductContentUpdateForm({ shopDomain }: { shopDomain: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ProductContentCsvRow[]>([]);
  const [skuColumn, setSkuColumn] = useState("");
  const [fieldMapping, setFieldMapping] = useState<Partial<Record<UpdatableField, string>>>({});

  const [groups, setGroups] = useState<ProductContentGroup[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, startLookup] = useTransition();
  const [looked, setLooked] = useState(false);

  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState(0);
  const cancelledRef = useRef(false);

  const resetResults = () => {
    setGroups([]);
    setLooked(false);
    setLookupError(null);
    setExcluded({});
    setRowStatus({});
    setApplyProgress(null);
    setApplyError(null);
    setFilterTab(0);
  };

  const handleDrop = (accepted: File[]) => {
    const picked = accepted[0];
    if (!picked) return;
    setFile(picked);
    setParseError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseProductContentCsv(String(reader.result ?? ""));
      if (parsed.headers.length === 0) {
        setParseError("Couldn't find any columns in this file — is it empty?");
        setHeaders([]);
        setRows([]);
        return;
      }
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setSkuColumn(parsed.suggestedSkuColumn ?? "");
      setFieldMapping(parsed.suggestedFieldColumns);
      resetResults();
    };
    reader.readAsText(picked);
  };

  const clearFile = () => {
    setFile(null);
    setParseError(null);
    setHeaders([]);
    setRows([]);
    setSkuColumn("");
    setFieldMapping({});
    resetResults();
  };

  const changeFieldMapping = (field: UpdatableField, column: string) => {
    setFieldMapping((prev) => {
      const next = { ...prev };
      if (column) next[field] = column;
      else delete next[field];
      return next;
    });
    resetResults();
  };

  const changeSkuColumn = (value: string) => {
    setSkuColumn(value);
    resetResults();
  };

  const mapped = skuColumn ? mapProductContentRows(rows, skuColumn, fieldMapping) : null;

  const runLookup = () => {
    if (!mapped || mapped.rows.length === 0) return;
    setLookupError(null);
    startLookup(async () => {
      const result = await lookupProductContentGroupsAction(mapped.rows);
      if (!result.ok) {
        setLookupError(result.error ?? "Couldn't look up products.");
        return;
      }
      setGroups(result.groups);
      setExcluded({});
      setRowStatus({});
      setLooked(true);
      setFilterTab(0);
    });
  };

  const entries = groups.flatMap((group) => group.products.map((product) => ({ group, product })));
  const foundGroups = groups.filter((g) => g.products.length > 0);
  const notFoundGroups = groups.filter((g) => g.products.length === 0);
  const sharedGroups = groups.filter((g) => g.products.length > 1);
  const sharedEntries = sharedGroups.flatMap((group) => group.products.map((product) => ({ group, product })));
  const sharedExcludedCount = sharedEntries.filter(({ product }) => excluded[product.id]).length;
  const allSharedExcluded = sharedEntries.length > 0 && sharedExcludedCount === sharedEntries.length;

  const needsUpdate = (product: ProductContentMatch, group: ProductContentGroup) =>
    !excluded[product.id] && !alreadyMatches(product, group.fields);
  const eligibleEntries = entries.filter(({ product, group }) => needsUpdate(product, group));
  const alreadyCurrentCount = entries.filter(
    ({ product, group }) => !excluded[product.id] && alreadyMatches(product, group.fields),
  ).length;

  const filterTabs = [
    { id: "all", content: `All (${groups.length})` },
    { id: "found", content: `Found in store (${foundGroups.length})` },
    { id: "not-found", content: `Not found (${notFoundGroups.length})` },
    { id: "shared", content: `Shared SKUs (${sharedEntries.length})` },
  ];
  const visibleGroups =
    filterTab === 1 ? foundGroups : filterTab === 2 ? notFoundGroups : filterTab === 3 ? sharedGroups : groups;
  const visibleTabLabel = ["all", "found-in-store", "not-found", "shared-skus"][filterTab] ?? "all";

  const toggleAllShared = () => {
    const nextValue = !allSharedExcluded;
    setExcluded((prev) => {
      const next = { ...prev };
      for (const { product } of sharedEntries) next[product.id] = nextValue;
      return next;
    });
  };

  const downloadVisibleCsv = () => {
    const exportRows = visibleGroups.flatMap((group) => {
      const fieldSummary = (Object.entries(group.fields) as [UpdatableField, string][])
        .map(([key, value]) => `${FIELD_LABEL[key]}: ${truncate(value, 60)}`)
        .join(" | ");
      // Always led by the SKU from the file, so every row can be traced back to it, found or not.
      if (group.products.length === 0) {
        return [[group.identifier, "", "", "Not found in store", fieldSummary, ""]];
      }
      const shared = group.products.length > 1;
      return group.products.map((product) => {
        const result = excluded[product.id]
          ? "Left out by you"
          : alreadyMatches(product, group.fields)
            ? "Already up to date"
            : shared
              ? `Will update (shared SKU, ${group.products.length} products)`
              : "Will update";
        return [
          group.identifier,
          product.title,
          idFromGid(product.id),
          result,
          fieldSummary,
          shopDomain ? `https://${shopDomain}/admin/products/${idFromGid(product.id)}` : "",
        ];
      });
    });
    const csv = buildCsv(["SKU", "Product title", "Product ID", "Result", "Fields to update", "Product link"], exportRows);
    downloadCsv(csv, `product-content-update-${visibleTabLabel}.csv`);
  };

  const cancelApply = () => {
    cancelledRef.current = true;
  };

  const applyAll = async () => {
    cancelledRef.current = false;
    setApplyError(null);
    setApplying(true);
    setApplyProgress({ done: 0, total: eligibleEntries.length });
    setRowStatus((prev) => {
      const next = { ...prev };
      for (const { product } of eligibleEntries) next[product.id] = { state: "pending" };
      return next;
    });

    try {
      await mapWithConcurrency(eligibleEntries, APPLY_CONCURRENCY, async ({ group, product }) => {
        if (cancelledRef.current) return;
        const result = await applyProductContentUpdateAction(product.id, group.fields);
        setRowStatus((prev) => ({
          ...prev,
          [product.id]: result.ok ? { state: "done" } : { state: "error", message: result.error },
        }));
        setApplyProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      });
    } finally {
      setApplying(false);
    }
  };

  const totalDataRows = rows.length;

  return (
    <Page
      fullWidth
      title="Product content update by CSV"
      backAction={{ content: "Products", url: "/products" }}
    >
      <Layout>
        <Layout.Section>
          <ProductContentMappingPanel
            file={file}
            onDrop={handleDrop}
            onClearFile={clearFile}
            parseError={parseError}
            headers={headers}
            totalDataRows={totalDataRows}
            skuColumn={skuColumn}
            onSkuColumnChange={changeSkuColumn}
            fieldMapping={fieldMapping}
            onFieldMappingChange={changeFieldMapping}
            readyCount={mapped?.rows.length ?? 0}
            skippedNoSku={mapped?.skippedNoSku.length ?? 0}
            skippedNoValues={mapped?.skippedNoValues.length ?? 0}
            onLookup={runLookup}
            looking={looking}
          />
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
                    <StatTile value={entries.length} label="Products matched" tone="info" />
                    <StatTile value={foundGroups.length} label="Found in store" tone="success" />
                    <StatTile value={notFoundGroups.length} label="Not found" tone="critical" />
                    <StatTile value={sharedEntries.length} label="On shared SKUs" tone="caution" />
                    <StatTile value={alreadyCurrentCount} label="Already up to date" tone="neutral" />
                  </div>

                  {applyError && (
                    <Banner tone="critical"><p>{applyError}</p></Banner>
                  )}

                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued" variant="bodySm">
                      {applyProgress
                        ? `${applyProgress.done}/${applyProgress.total} processed`
                        : `${eligibleEntries.length} product${eligibleEntries.length === 1 ? "" : "s"} will actually change.`}
                    </Text>
                    <InlineStack gap="200">
                      <Button onClick={cancelApply} tone="critical" disabled={!applying}>
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        loading={applying}
                        disabled={eligibleEntries.length === 0}
                        onClick={applyAll}
                      >
                        {applying && applyProgress
                          ? `Updating… (${applyProgress.done}/${applyProgress.total})`
                          : `Update ${eligibleEntries.length} product${eligibleEntries.length === 1 ? "" : "s"}`}
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card padding="0">
                <Box padding="200" paddingInlineEnd="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <div style={{ flex: 1 }}>
                      <Tabs tabs={filterTabs} selected={filterTab} onSelect={setFilterTab} />
                    </div>
                    <Button onClick={downloadVisibleCsv} disabled={visibleGroups.length === 0}>
                      Download CSV
                    </Button>
                  </InlineStack>
                </Box>
              </Card>

              {filterTab === 3 && sharedEntries.length > 0 && (
                <Card>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued" variant="bodySm">
                      {sharedExcludedCount} of {sharedEntries.length} products on shared SKUs are set to not
                      update.
                    </Text>
                    <Button onClick={toggleAllShared}>
                      {allSharedExcluded
                        ? `Include all shared (${sharedEntries.length})`
                        : `Don't update any shared (${sharedEntries.length})`}
                    </Button>
                  </InlineStack>
                </Card>
              )}

              {visibleGroups.map((group) => (
                <Card key={group.identifier} padding="0">
                  <Box padding="300" borderBlockEndWidth="025" borderColor="border" background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">SKU {group.identifier}</Text>
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
                        const status = rowStatus[product.id];
                        const upToDate = alreadyMatches(product, group.fields);
                        const isExcluded = Boolean(excluded[product.id]);
                        return (
                          <Box key={product.id} padding="300" borderBlockEndWidth="025" borderColor="border">
                            <BlockStack gap="200">
                              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                                <InlineStack gap="300" blockAlign="center" wrap={false}>
                                  <Thumbnail source={product.imageUrl ?? ImageIcon} alt={product.title} size="small" />
                                  <Box minWidth="0">
                                    <BlockStack gap="050">
                                      <InlineStack gap="150" blockAlign="center" wrap={false}>
                                        <Box minWidth="0">
                                          <Link href={`/products/${idFromGid(product.id)}`}>
                                            <Text as="span" fontWeight="semibold" truncate>{product.title}</Text>
                                          </Link>
                                        </Box>
                                        <Badge tone={STATUS_TONE[product.status]} size="small">
                                          {product.status.charAt(0) + product.status.slice(1).toLowerCase()}
                                        </Badge>
                                      </InlineStack>
                                      <Text as="span" tone="subdued" variant="bodySm">
                                        {product.categoryName ?? "No category set"}
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                </InlineStack>

                                <InlineStack gap="200" blockAlign="center">
                                  {status?.state === "pending" && (
                                    <InlineStack gap="100" blockAlign="center">
                                      <Spinner size="small" accessibilityLabel="Updating" />
                                      <Badge tone="info">Updating…</Badge>
                                    </InlineStack>
                                  )}
                                  {status?.state === "done" && <Badge tone="success">Updated</Badge>}
                                  {status?.state === "error" && <Badge tone="critical">{status.message ?? "Error"}</Badge>}
                                  {!status && upToDate && !isExcluded && <Badge>Already up to date</Badge>}
                                  {!status && isExcluded && <Badge tone="warning">Won&apos;t update</Badge>}
                                </InlineStack>
                              </InlineStack>

                              <BlockStack gap="100">
                                {(Object.entries(group.fields) as [UpdatableField, string][]).map(([key, value]) => {
                                  const current =
                                    key === "title"
                                      ? product.current.title
                                      : key === "descriptionHtml"
                                        ? product.current.descriptionHtml
                                        : key === "tags"
                                          ? product.current.tags.join(", ")
                                          : key === "seoTitle"
                                            ? (product.current.seoTitle ?? "")
                                            : (product.current.seoDescription ?? "");
                                  return (
                                    <InlineStack key={key} gap="150" wrap={false} blockAlign="start">
                                      <Box minWidth="130px">
                                        <Text as="span" variant="bodySm" fontWeight="medium">{FIELD_LABEL[key]}</Text>
                                      </Box>
                                      <Text as="span" variant="bodySm" tone="subdued">
                                        {current ? truncate(current) : "(empty)"}
                                      </Text>
                                      <Text as="span" variant="bodySm" tone="subdued">→</Text>
                                      <Text as="span" variant="bodySm">{truncate(value)}</Text>
                                    </InlineStack>
                                  );
                                })}
                              </BlockStack>

                              <Checkbox
                                label="Don't update this product"
                                checked={isExcluded}
                                disabled={applying}
                                onChange={(checked) =>
                                  setExcluded((prev) => ({ ...prev, [product.id]: checked }))
                                }
                              />
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
