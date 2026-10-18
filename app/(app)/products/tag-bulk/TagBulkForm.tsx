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
  DropZone,
  Icon,
  Badge,
  Thumbnail,
  Checkbox,
  Box,
  Tabs,
  Spinner,
  Collapsible,
} from "@shopify/polaris";
import { FileIcon, XCircleIcon, ImageIcon } from "@shopify/polaris-icons";
import { idFromGid } from "@/lib/format";
import { formatFileSize } from "@/lib/csvSkuColors";
import { parseTagBulkCsv, type TagBulkCsvRow, type SkippedCsvRow } from "@/lib/csvTagBulk";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  lookupTagBulkGroupsAction,
  addTagsToProductAction,
  type TagBulkGroup,
  type TagBulkProduct,
} from "./actions";

type RowStatus = { state: "idle" | "pending" | "done" | "skipped" | "error"; message?: string };

const APPLY_CONCURRENCY = 5;


function hasAllTags(product: TagBulkProduct, tagsToAdd: string[]): boolean {
  const existing = new Set(product.currentTags.map((t) => t.trim().toLowerCase()));
  return tagsToAdd.every((tag) => existing.has(tag.trim().toLowerCase()));
}

const STATUS_TONE: Record<TagBulkProduct["status"], "success" | "info" | "warning"> = {
  ACTIVE: "success",
  DRAFT: "info",
  ARCHIVED: "warning",
};

export function TagBulkForm({ shopDomain }: { shopDomain: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<TagBulkCsvRow[]>([]);
  // Raw CSV data lines read, before merging rows that share an identifier —
  // shown alongside `rows.length` so that merge never looks like data loss.
  const [totalRowsRead, setTotalRowsRead] = useState(0);
  // Rows with no column-1 value, or nothing usable as a tag (e.g. an empty
  // Tags cell) — surfaced explicitly instead of just vanishing from the count.
  const [skippedRows, setSkippedRows] = useState<SkippedCsvRow[]>([]);
  const [showAllSkipped, setShowAllSkipped] = useState(false);
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [isSku, setIsSku] = useState(true);

  const [groups, setGroups] = useState<TagBulkGroup[]>([]);
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

  const handleFile = (picked: File) => {
    setFile(picked);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseTagBulkCsv(String(reader.result ?? ""));
      setRows(parsed.rows);
      setTotalRowsRead(parsed.totalRowsRead);
      setSkippedRows(parsed.skippedRows);
      setShowAllSkipped(false);
      setSkippedOpen(false);
      resetResults();
    };
    reader.readAsText(picked);
  };

  const clearFile = () => {
    setFile(null);
    setRows([]);
    setTotalRowsRead(0);
    setSkippedRows([]);
    setShowAllSkipped(false);
    resetResults();
  };

  const runLookup = () => {
    setLookupError(null);
    startLookup(async () => {
      const result = await lookupTagBulkGroupsAction(rows, isSku);
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

  const needsUpdate = (product: TagBulkProduct, group: TagBulkGroup) =>
    !excluded[product.id] && !hasAllTags(product, group.tagsToAdd);
  const eligibleEntries = entries.filter(({ product, group }) => needsUpdate(product, group));
  const alreadyTaggedCount = entries.filter(
    ({ product, group }) => !excluded[product.id] && hasAllTags(product, group.tagsToAdd),
  ).length;

  const filterTabs = [
    { id: "all", content: `All (${groups.length})` },
    { id: "found", content: `Found in store (${foundGroups.length})` },
    { id: "not-found", content: `Not found (${notFoundGroups.length})` },
    { id: "shared", content: `Shared identifiers (${sharedEntries.length})` },
  ];
  const visibleGroups =
    filterTab === 1 ? foundGroups : filterTab === 2 ? notFoundGroups : filterTab === 3 ? sharedGroups : groups;
  const visibleTabLabel = ["all", "found-in-store", "not-found", "shared-identifiers"][filterTab] ?? "all";

  /**
   * Exports whatever the current filter tab is showing — one row per matched
   * product (using its real Shopify title and admin link), or one row per
   * not-found identifier (title falls back to the identifier, link blank).
   */
  const downloadVisibleCsv = () => {
    const exportRows = visibleGroups.flatMap((group) => {
      if (group.products.length === 0) {
        return [[group.identifier, group.tagsToAdd.join(", "), ""]];
      }
      return group.products.map((product) => [
        product.title,
        group.tagsToAdd.join(", "),
        shopDomain ? `https://${shopDomain}/admin/products/${idFromGid(product.id)}` : "",
      ]);
    });
    const csv = buildCsv(["Title", "Tags", "Product link"], exportRows);
    downloadCsv(csv, `tag-bulk-${visibleTabLabel}.csv`);
  };

  const toggleAllShared = () => {
    const nextValue = !allSharedExcluded;
    setExcluded((prev) => {
      const next = { ...prev };
      for (const { product } of sharedEntries) next[product.id] = nextValue;
      return next;
    });
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
        const result = await addTagsToProductAction(product.id, group.tagsToAdd);
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

  return (
    <Page
      fullWidth
      title="Bulk tag insert by CSV"
      backAction={{ content: "Products", url: "/products" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">Upload a CSV</Text>
              <Text as="p" tone="subdued">
                Column 1 is the product {isSku ? "SKU" : "title"}; everything after it is read as tags —
                either one quoted <code>&quot;tag1, tag2, tag3&quot;</code> column or several plain columns.
                Multiple rows for the same {isSku ? "SKU" : "title"} merge their tags together. Products
                sharing a {isSku ? "SKU" : "title"} are grouped below.
                {!isSku && (
                  <>
                    {" "}Title matches don&apos;t have to be exact character-for-character — a base name also
                    matches store products that extend it with a variant suffix (e.g. &quot;REBUKE HOCKEY
                    GLOVE&quot; matching &quot;REBUKE HOCKEY GLOVE Right&quot;), marked with a{" "}
                    <Badge tone="attention" size="small">Prefix match</Badge> badge so you can review them.
                  </>
                )}
              </Text>

              <Checkbox
                label="Match by SKU"
                helpText={
                  isSku
                    ? "Column 1 is treated as a product SKU."
                    : "Off — column 1 is matched against the exact product title instead."
                }
                checked={isSku}
                onChange={(checked) => {
                  setIsSku(checked);
                  resetResults();
                }}
              />

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

              {rows.length > 0 && !looked && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" tone="subdued">
                    {totalRowsRead} row{totalRowsRead === 1 ? "" : "s"} read
                    {totalRowsRead !== rows.length && (
                      <> → {rows.length} unique {isSku ? "SKU" : "title"}{rows.length === 1 ? "" : "s"} (rows sharing an identifier were merged)</>
                    )}
                  </Text>
                  <Button variant="primary" loading={looking} onClick={runLookup}>
                    Look up products
                  </Button>
                </InlineStack>
              )}

              {skippedRows.length > 0 && (
                <Banner tone="warning" title={`${skippedRows.length} row${skippedRows.length === 1 ? "" : "s"} couldn't be read`}>
                  <BlockStack gap="200">
                    <Text as="p">
                      Every other row was read successfully — these specific ones had either no value in
                      column 1, or nothing usable as a tag in the columns after it (often a blank Tags cell,
                      or tag text that ended up pasted into column 1 instead). Nothing was guessed or dropped
                      silently; fix these in your source file and re-upload if you want them included.
                    </Text>
                    <Button
                      variant="plain"
                      onClick={() => setSkippedOpen((v) => !v)}
                      ariaExpanded={skippedOpen}
                      ariaControls="skipped-rows-detail"
                    >
                      {skippedOpen ? "Hide details" : `Show details (${skippedRows.length})`}
                    </Button>
                    <Collapsible
                      open={skippedOpen}
                      id="skipped-rows-detail"
                      transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
                    >
                      <BlockStack gap="200">
                        <BlockStack gap="100">
                          {(showAllSkipped ? skippedRows : skippedRows.slice(0, 10)).map((row) => (
                            <Text as="p" key={row.lineNumber} variant="bodySm" tone="subdued">
                              Line {row.lineNumber} ({row.reason === "no-identifier" ? "no value in column 1" : "no tags found"}):{" "}
                              <code>{row.raw.length > 120 ? `${row.raw.slice(0, 120)}…` : row.raw}</code>
                            </Text>
                          ))}
                        </BlockStack>
                        {skippedRows.length > 10 && (
                          <Button variant="plain" onClick={() => setShowAllSkipped((v) => !v)}>
                            {showAllSkipped ? "Show fewer" : `Show all ${skippedRows.length}`}
                          </Button>
                        )}
                      </BlockStack>
                    </Collapsible>
                  </BlockStack>
                </Banner>
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
                  {totalRowsRead !== groups.length && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      {totalRowsRead} CSV rows read, merged into {groups.length} unique {isSku ? "SKUs" : "titles"}{" "}
                      below — nothing was dropped.
                    </Text>
                  )}
                  <div className="stat-grid">
                    <StatTile value={groups.length} label={`${isSku ? "SKUs" : "Titles"} looked up`} tone="neutral" />
                    <StatTile value={entries.length} label="Products matched" tone="info" />
                    <StatTile value={foundGroups.length} label="Found in store" tone="success" />
                    <StatTile value={notFoundGroups.length} label="Not found" tone="critical" />
                    <StatTile value={sharedEntries.length} label="On shared identifiers" tone="caution" />
                    <StatTile value={alreadyTaggedCount} label="Already tagged" tone="neutral" />
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
                          ? `Adding tags… (${applyProgress.done}/${applyProgress.total})`
                          : `Add tags to ${eligibleEntries.length} product${eligibleEntries.length === 1 ? "" : "s"}`}
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
                      {sharedExcludedCount} of {sharedEntries.length} products on shared identifiers are set to
                      not update.
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
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingSm">
                          {isSku ? "SKU" : "Title"} {group.identifier}
                        </Text>
                        <InlineStack gap="100">
                          {group.tagsToAdd.map((tag) => (
                            <Badge key={tag} tone="info" size="small">{tag}</Badge>
                          ))}
                        </InlineStack>
                      </BlockStack>
                      {group.products.length > 1 && (
                        <Badge tone="attention">
                          {`${group.products.length} products share this ${isSku ? "SKU" : "title"}`}
                        </Badge>
                      )}
                    </InlineStack>
                  </Box>
                  <BlockStack gap="0">
                    {group.products.length === 0 ? (
                      <Box padding="400">
                        <Text as="p" tone="subdued">No product found with this {isSku ? "SKU" : "title"}.</Text>
                      </Box>
                    ) : (
                      group.products.map((product) => {
                        const status = rowStatus[product.id];
                        const alreadyTagged = hasAllTags(product, group.tagsToAdd);
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
                                        {product.matchType === "prefix" && (
                                          <Badge tone="attention" size="small">Prefix match</Badge>
                                        )}
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
                                      <Spinner size="small" accessibilityLabel="Adding tags" />
                                      <Badge tone="info">Adding…</Badge>
                                    </InlineStack>
                                  )}
                                  {status?.state === "done" && <Badge tone="success">Tags added</Badge>}
                                  {status?.state === "error" && <Badge tone="critical">{status.message ?? "Error"}</Badge>}
                                  {!status && alreadyTagged && !isExcluded && <Badge>Already tagged</Badge>}
                                  {!status && isExcluded && <Badge tone="warning">Won&apos;t update</Badge>}
                                </InlineStack>
                              </InlineStack>

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
