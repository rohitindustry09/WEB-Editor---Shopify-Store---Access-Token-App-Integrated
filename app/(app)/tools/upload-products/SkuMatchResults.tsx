"use client";

import { StatTile } from "@/components/ui/StatTile";

import { useState, type ReactNode } from "react";
import {
  Card,
  Box,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Badge,
  Tabs,
  TextField,
  DataTable,
  IndexTable,
  Pagination,
  Link,
  ProgressBar,
  EmptySearchResult,
} from "@shopify/polaris";
import type { IndexTableProps } from "@shopify/polaris";
import { ListBulletedIcon, HashtagIcon, EditIcon, PlusCircleIcon, AlertCircleIcon, ExportIcon } from "@shopify/polaris-icons";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { idFromGid } from "@/lib/format";
import type { SkuTarget } from "@/lib/skuApply";
import type { CsvSkuRow, SkuMatchReport, StoreSkuEntry } from "@/lib/skuMatch";
import { ApplyPanel } from "./ApplyPanel";

const PAGE_SIZE = 50;
/** A SKU shared by many store products lists this many of them inline, then "+N more". */
const MAX_SHOWN_MATCHES = 5;



const STATUS_TONE = { ACTIVE: "success", DRAFT: "info", ARCHIVED: "warning" } as const;

type TabId = "update" | "new" | "no-sku";

function padCells(row: CsvSkuRow, width: number): string[] {
  return Array.from({ length: width }, (_, i) => row.cells[i] ?? "");
}

function rowsPreview(rows: CsvSkuRow[]): string {
  return rows.map((r) => `#${r.rowNumber}`).slice(0, 6).join(", ") + (rows.length > 6 ? `, +${rows.length - 6} more` : "");
}

const EMPTY_COPY: Record<TabId, { title: string; body: string }> = {
  update: { title: "No SKUs matched", body: "None of the CSV's SKUs exist in the store, so every one is a new product." },
  new: { title: "Nothing new", body: "Every SKU in your CSV already exists in the store." },
  "no-sku": { title: "No blank SKUs", body: "Every row in the CSV has a SKU value." },
};

type Headings = IndexTableProps["headings"];

export function SkuMatchResults({
  report,
  headers,
  shopDomain,
  storeName,
  target,
  settingsVersion,
  onResetSettings,
}: {
  report: SkuMatchReport;
  headers: string[];
  shopDomain: string;
  storeName: string;
  /** Where new products store their SKU; null when the chosen store field can't hold it. */
  target: SkuTarget | null;
  /** Changes whenever saved settings are reset, which rebuilds the Upload & Update panel from the defaults. */
  settingsVersion: number;
  onResetSettings: () => void;
}) {
  const [tab, setTab] = useState<TabId>("update");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  // Everything is included by default — a SKU lands here only when the user unchecks it.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const tabs: { id: TabId; content: string }[] = [
    { id: "update", content: `Update (${report.update.length.toLocaleString()})` },
    { id: "new", content: `New products (${report.created.length.toLocaleString()})` },
    { id: "no-sku", content: `No SKU (${report.blankRows.length.toLocaleString()})` },
  ];

  const productLink = (entry: StoreSkuEntry): ReactNode =>
    shopDomain ? (
      <Link url={`https://${shopDomain}/admin/products/${idFromGid(entry.productId)}`} target="_blank" removeUnderline>
        {entry.title}
      </Link>
    ) : (
      entry.title
    );

  const needle = query.trim().toLowerCase();

  const updateRows = report.update.filter(
    (g) => !needle || g.sku.toLowerCase().includes(needle) || g.matches.some((m) => m.title.toLowerCase().includes(needle)),
  );
  const newRows = report.created.filter((g) => !needle || g.sku.toLowerCase().includes(needle));
  const noSkuRows = report.blankRows.filter((r) => !needle || r.cells.some((c) => c.toLowerCase().includes(needle)));

  // A SKU shared by several store products is ambiguous — it can be listed but never updated from here.
  const includedUpdate = report.update.filter((g) => !g.sharedByProducts && !skipped.has(g.sku));
  const includedNew = report.created.filter((g) => !skipped.has(g.sku));
  const sharedCount = report.update.filter((g) => g.sharedByProducts).length;
  const untickedCount =
    report.update.filter((g) => !g.sharedByProducts && skipped.has(g.sku)).length + report.created.filter((g) => skipped.has(g.sku)).length;

  const activeCount = { update: updateRows.length, new: newRows.length, "no-sku": noSkuRows.length }[tab];
  const pageCount = Math.max(1, Math.ceil(activeCount / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const slice = <T,>(rows: T[]): T[] => rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const isSelectableTab = tab === "update" || tab === "new";
  const pageUpdate = tab === "update" ? slice(updateRows) : [];
  const pageNew = tab === "new" ? slice(newRows) : [];
  const pageIds = (tab === "update" ? pageUpdate : pageNew).filter((g) => !("sharedByProducts" in g && g.sharedByProducts)).map((g) => g.sku);
  const selectedOnPage = pageIds.filter((id) => !skipped.has(id)).length;

  const setIncluded = (ids: string[], include: boolean) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (include) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  // Polaris's SelectionType enum isn't exported from the package root, so its string values are matched directly.
  const handleSelection: NonNullable<IndexTableProps["onSelectionChange"]> = (selectionType, isSelecting, selection) => {
    const kind: string = selectionType;
    if (kind === "all" || kind === "page") {
      setIncluded(pageIds, isSelecting);
    } else if (kind === "single" && typeof selection === "string") {
      setIncluded([selection], isSelecting);
    } else if (Array.isArray(selection)) {
      const rows = tab === "update" ? pageUpdate : pageNew;
      setIncluded(
        rows.slice(selection[0], selection[1] + 1).filter((g) => !("sharedByProducts" in g && g.sharedByProducts)).map((g) => g.sku),
        isSelecting,
      );
    }
  };

  const allFilteredIds = (tab === "update" ? updateRows.filter((g) => !g.sharedByProducts) : newRows).map((g) => g.sku);

  const download = () => {
    const width = headers.length;
    if (tab === "update") {
      const csv = buildCsv(
        [...headers, "Store product", "Store product ID", "Store status", "Store handle", "Included in Upload & Update"],
        updateRows.flatMap((g) =>
          g.rows.map((r) => [
            ...padCells(r, width),
            g.matches.map((m) => m.title).join(" | "),
            g.matches.map((m) => idFromGid(m.productId)).join(" | "),
            g.matches.map((m) => m.status).join(" | "),
            g.matches.map((m) => m.handle).join(" | "),
            !g.sharedByProducts && !skipped.has(g.sku) ? "Yes" : "No",
          ]),
        ),
      );
      downloadCsv(csv, "upload-products-update.csv");
    } else if (tab === "new") {
      downloadCsv(
        buildCsv([...headers, "Included in Upload & Update"], newRows.flatMap((g) => g.rows.map((r) => [...padCells(r, width), skipped.has(g.sku) ? "No" : "Yes"]))),
        "upload-products-new.csv",
      );
    } else {
      downloadCsv(buildCsv(headers, noSkuRows.map((r) => padCells(r, width))), "upload-products-no-sku.csv");
    }
  };

  const foundPct = report.uniqueCsvSkuCount > 0 ? (report.update.length / report.uniqueCsvSkuCount) * 100 : 0;
  const empty = needle ? { title: "No results", body: `Nothing matches "${query.trim()}" in this list.` } : EMPTY_COPY[tab];

  const updateHeadings: Headings = [
    { title: "CSV SKU" },
    { title: "CSV rows", alignment: "end" },
    { title: "Store product" },
    { title: "Status" },
    { title: "Note" },
  ];
  const newHeadings: Headings = [{ title: "CSV SKU" }, { title: "CSV rows", alignment: "end" }, { title: "Row numbers" }];

  const promotedBulkActions = [{ content: "Skip selected", onAction: () => setIncluded(pageIds.filter((id) => !skipped.has(id)), false) }];

  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone="info">Step 3</Badge>
            <Text as="h2" variant="headingMd">Review and upload</Text>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            Every unique CSV SKU is either found in the store (update) or not (new product).
          </Text>
        </BlockStack>

        <div className="stat-grid">
          <StatTile value={report.csvRowCount} label="CSV rows" tone="neutral" icon={ListBulletedIcon} />
          <StatTile value={report.uniqueCsvSkuCount} label="Unique CSV SKUs" tone="neutral" icon={HashtagIcon} />
          <StatTile value={report.update.length} label="Found — will update" tone="success" icon={EditIcon} />
          <StatTile value={report.created.length} label="Not found — new products" tone="info" icon={PlusCircleIcon} />
          <StatTile value={report.blankRows.length} label="Rows with no SKU" tone="critical" icon={AlertCircleIcon} />
        </div>

        {report.uniqueCsvSkuCount > 0 && (
          <BlockStack gap="150">
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">Share of CSV SKUs already in the store</Text>
              <Text as="span" variant="bodySm" fontWeight="semibold">{`${foundPct.toFixed(1)}%`}</Text>
            </InlineStack>
            <ProgressBar progress={foundPct} tone="success" size="small" />
          </BlockStack>
        )}

        <ApplyPanel
          key={settingsVersion}
          onResetSettings={onResetSettings}
          headers={headers}
          updateGroups={includedUpdate}
          createGroups={includedNew}
          sharedCount={sharedCount}
          sharedGroups={report.update.filter((g) => g.sharedByProducts)}
          untickedCount={untickedCount}
          target={target}
          storeName={storeName}
        />

        <Tabs
          tabs={tabs}
          selected={tabs.findIndex((t) => t.id === tab)}
          onSelect={(index) => {
            setTab(tabs[index].id);
            setPage(0);
          }}
        />

        {isSelectableTab && (
          <Banner tone="info">
            <p>
              Checked rows are included when you press Upload & Update. Uncheck a row to skip that SKU — the header checkbox
              checks or unchecks every row on this page.
              {tab === "update" && " SKUs shared by several store products can't be updated from here and stay unchecked."}
            </p>
          </Banner>
        )}

        <InlineStack align="space-between" blockAlign="center" gap="300">
          <Box minWidth="240px" maxWidth="400px" width="100%">
            <TextField
              label="Search"
              labelHidden
              placeholder="Search SKU or product"
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(0);
              }}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setQuery("")}
            />
          </Box>
          <InlineStack gap="200">
            {isSelectableTab && (
              <>
                <Button variant="tertiary" onClick={() => setIncluded(allFilteredIds, true)} disabled={activeCount === 0}>
                  {`Include all ${allFilteredIds.length.toLocaleString()}`}
                </Button>
                <Button variant="tertiary" onClick={() => setIncluded(allFilteredIds, false)} disabled={activeCount === 0}>
                  Skip all
                </Button>
              </>
            )}
            <Button icon={ExportIcon} onClick={download} disabled={activeCount === 0}>
              {`Download ${activeCount.toLocaleString()} as CSV`}
            </Button>
          </InlineStack>
        </InlineStack>

        {activeCount === 0 ? (
          <EmptySearchResult title={empty.title} description={empty.body} withIllustration={false} />
        ) : (
          <>
            {tab === "update" && (
              <IndexTable
                resourceName={{ singular: "SKU", plural: "SKUs" }}
                itemCount={pageUpdate.length}
                selectedItemsCount={pageIds.length > 0 && selectedOnPage === pageIds.length ? "All" : selectedOnPage}
                onSelectionChange={handleSelection}
                headings={updateHeadings}
                promotedBulkActions={promotedBulkActions}
              >
                {pageUpdate.map((g, index) => (
                  <IndexTable.Row
                    id={g.sku}
                    key={g.sku}
                    position={index}
                    selected={!g.sharedByProducts && !skipped.has(g.sku)}
                    disabled={g.sharedByProducts}
                  >
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">{g.sku}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" alignment="end" numeric>{g.rows.length}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <BlockStack gap="100">
                        {g.matches.slice(0, MAX_SHOWN_MATCHES).map((m) => (
                          <span key={m.variantId ?? m.productId}>{productLink(m)}</span>
                        ))}
                        {g.matches.length > MAX_SHOWN_MATCHES && (
                          <Text as="span" variant="bodySm" tone="subdued">{`+${g.matches.length - MAX_SHOWN_MATCHES} more`}</Text>
                        )}
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <BlockStack gap="100">
                        {g.matches.slice(0, MAX_SHOWN_MATCHES).map((m) => (
                          <span key={m.variantId ?? m.productId}>
                            <Badge tone={STATUS_TONE[m.status]}>{m.status.toLowerCase()}</Badge>
                          </span>
                        ))}
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{g.sharedByProducts ? <Badge tone="attention">Shared SKU — skipped</Badge> : ""}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}

            {tab === "new" && (
              <IndexTable
                resourceName={{ singular: "SKU", plural: "SKUs" }}
                itemCount={pageNew.length}
                selectedItemsCount={pageIds.length > 0 && selectedOnPage === pageIds.length ? "All" : selectedOnPage}
                onSelectionChange={handleSelection}
                headings={newHeadings}
                promotedBulkActions={promotedBulkActions}
              >
                {pageNew.map((g, index) => (
                  <IndexTable.Row id={g.sku} key={g.sku} position={index} selected={!skipped.has(g.sku)}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">{g.sku}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" alignment="end" numeric>{g.rows.length}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{rowsPreview(g.rows)}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}

            {tab === "no-sku" && (
              <DataTable
                columnContentTypes={["text", ...headers.slice(0, 3).map(() => "text" as const)]}
                headings={["Row", ...headers.slice(0, 3)]}
                rows={slice(noSkuRows).map((r) => [`#${r.rowNumber}`, ...padCells(r, headers.length).slice(0, 3)])}
                hasZebraStripingOnData
                stickyHeader
              />
            )}

            {pageCount > 1 && (
              <InlineStack align="center">
                <Pagination
                  hasPrevious={currentPage > 0}
                  onPrevious={() => setPage(currentPage - 1)}
                  hasNext={currentPage < pageCount - 1}
                  onNext={() => setPage(currentPage + 1)}
                  label={`${(currentPage * PAGE_SIZE + 1).toLocaleString()}-${Math.min((currentPage + 1) * PAGE_SIZE, activeCount).toLocaleString()} of ${activeCount.toLocaleString()}`}
                />
              </InlineStack>
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );
}
