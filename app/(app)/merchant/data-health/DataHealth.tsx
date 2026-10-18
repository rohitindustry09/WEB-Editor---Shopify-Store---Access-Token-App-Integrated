"use client";

import { useMemo, useState } from "react";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, InlineStack, Link as PolarisLink, Page, Pagination, Text } from "@shopify/polaris";
import { CatalogFilterBar } from "@/components/merchant/CatalogFilterBar";
import { StatTile, type StatTone } from "@/components/ui/StatTile";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { idFromGid } from "@/lib/format";
import { newRunId, runChanges, type ClientChange } from "@/lib/merchant/applyClient";
import { analyzeCatalog, ISSUES, suggestSeoDescription, suggestSeoTitle, type IssueType } from "@/lib/merchant/health";
import type { CatalogFilter, CatalogRow, HistoryEntry } from "@/lib/merchant/types";
import { useCatalog } from "@/lib/merchant/useCatalog";

const PAGE_SIZE = 50;
const TONE: Record<string, StatTone> = { critical: "critical", caution: "caution", info: "info" };

type SeoFix = "title" | "description";

/** One SEO change per product that is missing the field, with the "before" saved for undo. */
function seoChanges(rows: CatalogRow[], fix: SeoFix): ClientChange[] {
  const changes: ClientChange[] = [];
  for (const row of rows) {
    const title = fix === "title" ? suggestSeoTitle(row) : undefined;
    const description = fix === "description" ? suggestSeoDescription(row) : undefined;
    if ((fix === "title" && !title) || (fix === "description" && !description)) continue;
    const entry: HistoryEntry = {
      kind: "productSeo",
      productId: row.productId,
      label: row.productTitle,
      before: { title: row.seoTitle, description: row.seoDescription },
      after: { title: title ?? row.seoTitle, description: description ?? row.seoDescription },
    };
    changes.push({ key: row.productId, item: { kind: "productSeo", productId: row.productId, seo: { ...(title ? { title } : {}), ...(description ? { description } : {}) } }, entries: [entry] });
  }
  return changes;
}

export function DataHealth({ shopDomain }: { shopDomain: string }) {
  const catalog = useCatalog();
  const [filter, setFilter] = useState<CatalogFilter>({});
  const [active, setActive] = useState<IssueType | null>(null);
  const [page, setPage] = useState(0);
  const [fixed, setFixed] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<SeoFix | null>(null);
  const [fixMessage, setFixMessage] = useState<string | null>(null);

  const issues = useMemo(() => analyzeCatalog(catalog.rows).filter((issue) => !(fixed.has(issue.row.productId) && (issue.type === "missingSeoTitle" || issue.type === "missingSeoDescription"))), [catalog.rows, fixed]);
  const counts = useMemo(() => {
    const tally = new Map<IssueType, number>();
    for (const issue of issues) tally.set(issue.type, (tally.get(issue.type) ?? 0) + 1);
    return tally;
  }, [issues]);

  const visible = active ? issues.filter((issue) => issue.type === active) : issues;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const shown = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const info = (type: IssueType) => ISSUES.find((candidate) => candidate.type === type);
  const adminUrl = (row: CatalogRow) => `https://${shopDomain}/admin/products/${idFromGid(row.productId)}`;

  const fixSeo = async (fix: SeoFix) => {
    const type: IssueType = fix === "title" ? "missingSeoTitle" : "missingSeoDescription";
    const rows = issues.filter((issue) => issue.type === type).map((issue) => issue.row);
    const changes = seoChanges(rows, fix);
    if (changes.length === 0) {
      setFixMessage("There is nothing to fill from — those products have no text to use.");
      return;
    }
    setFixing(fix);
    setFixMessage(null);
    const okKeys = new Set<string>();
    let firstError: string | null = null;
    await runChanges(changes, {
      history: { runId: newRunId(), tool: "Data health", label: `Fill ${changes.length} missing SEO ${fix === "title" ? "titles" : "descriptions"}` },
      onOutcomes: (outcomes) => {
        for (const { key, outcome } of outcomes) {
          if (outcome.ok) okKeys.add(key);
          else firstError ??= outcome.error ?? null;
        }
      },
    });
    setFixed((prev) => new Set([...prev, ...okKeys]));
    setFixing(null);
    setFixMessage(`${okKeys.size.toLocaleString()} of ${changes.length.toLocaleString()} products updated.${okKeys.size < changes.length ? ` Some failed: ${firstError ?? "unknown error"}` : " You can undo this from the change history."}`);
  };

  const exportCsv = () =>
    downloadCsv(
      buildCsv(
        ["Issue", "Product", "Variant", "SKU", "Barcode", "Price", "Vendor", "Status", "Admin link"],
        issues.map((issue) => [info(issue.type)?.label ?? issue.type, issue.row.productTitle, issue.row.variantTitle, issue.row.sku, issue.row.barcode, issue.row.price, issue.row.vendor, issue.row.status, adminUrl(issue.row)]),
      ),
      "data-health-issues.csv",
    );

  const productCount = new Set(catalog.rows.map((row) => row.productId)).size;
  const affectedProducts = new Set(issues.map((issue) => issue.row.productId)).size;

  return (
    <Page fullWidth title="Data health" subtitle="Scan the catalog for missing SKUs, duplicates, missing images, bad prices and weak SEO — then fix or export them.">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <CatalogFilterBar filter={filter} onChange={setFilter} onLoad={() => { setPage(0); setActive(null); setFixed(new Set()); void catalog.load(filter); }} onStop={catalog.stop} loading={catalog.loading} loadedCount={catalog.rows.length} loadLabel="Scan catalog" />
            {catalog.error && <Banner tone="critical"><p>{catalog.error}</p></Banner>}
          </BlockStack>
        </Card>

        {catalog.loaded && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{issues.length === 0 ? "No problems found" : `${issues.length.toLocaleString()} problems across ${affectedProducts.toLocaleString()} of ${productCount.toLocaleString()} products`}</Text>
                {issues.length > 0 && <Button onClick={exportCsv}>Download issues CSV</Button>}
              </InlineStack>

              {Object.values(filter).some((value) => value) && <Banner tone="info"><p>A filter is on, so duplicate SKUs and barcodes are only found among the variants that were loaded. Scan the whole catalog to catch every duplicate.</p></Banner>}

              <div className="stat-grid">
                {ISSUES.map((entry) => (
                  <StatTile
                    key={entry.type}
                    label={entry.label}
                    value={counts.get(entry.type) ?? 0}
                    tone={(counts.get(entry.type) ?? 0) === 0 ? "neutral" : TONE[entry.tone]}
                    active={active === entry.type}
                    onClick={() => {
                      setActive(active === entry.type ? null : entry.type);
                      setPage(0);
                    }}
                  />
                ))}
              </div>

              {active && <Text as="p" tone="subdued">{info(active)?.explain}</Text>}

              {(counts.get("missingSeoTitle") ?? 0) + (counts.get("missingSeoDescription") ?? 0) > 0 && (
                <InlineStack gap="300" blockAlign="center">
                  {(counts.get("missingSeoTitle") ?? 0) > 0 && (
                    <Button onClick={() => void fixSeo("title")} loading={fixing === "title"} disabled={fixing !== null}>
                      {`Fill ${counts.get("missingSeoTitle")} missing SEO titles from product titles`}
                    </Button>
                  )}
                  {(counts.get("missingSeoDescription") ?? 0) > 0 && (
                    <Button onClick={() => void fixSeo("description")} loading={fixing === "description"} disabled={fixing !== null}>
                      {`Fill ${counts.get("missingSeoDescription")} missing SEO descriptions from the description text`}
                    </Button>
                  )}
                </InlineStack>
              )}
              {fixMessage && <Banner tone="info" onDismiss={() => setFixMessage(null)}><p>{fixMessage}</p></Banner>}

              {visible.length > 0 && (
                <>
                  <IndexTable
                    resourceName={{ singular: "issue", plural: "issues" }}
                    itemCount={shown.length}
                    selectable={false}
                    headings={[{ title: "Issue" }, { title: "Product" }, { title: "SKU" }, { title: "Price" }, { title: "Status" }]}
                  >
                    {shown.map((issue, index) => {
                      const meta = info(issue.type);
                      return (
                        <IndexTable.Row id={`${issue.type}-${issue.row.variantId}`} key={`${issue.type}-${issue.row.variantId}`} position={index}>
                          <IndexTable.Cell><Badge tone={meta?.tone === "critical" ? "critical" : meta?.tone === "caution" ? "attention" : "info"}>{meta?.label ?? issue.type}</Badge></IndexTable.Cell>
                          <IndexTable.Cell>
                            <PolarisLink url={adminUrl(issue.row)} target="_blank" removeUnderline>{`${issue.row.productTitle}${issue.row.variantTitle ? ` · ${issue.row.variantTitle}` : ""}`}</PolarisLink>
                          </IndexTable.Cell>
                          <IndexTable.Cell>{issue.row.sku || "—"}</IndexTable.Cell>
                          <IndexTable.Cell>{issue.row.price}</IndexTable.Cell>
                          <IndexTable.Cell>{issue.row.status.toLowerCase()}</IndexTable.Cell>
                        </IndexTable.Row>
                      );
                    })}
                  </IndexTable>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued">{`Showing ${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min((page + 1) * PAGE_SIZE, visible.length).toLocaleString()} of ${visible.length.toLocaleString()}`}</Text>
                    <Pagination hasPrevious={page > 0} hasNext={page < pageCount - 1} onPrevious={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
