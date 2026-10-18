"use client";

import { useMemo, useRef, useState } from "react";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, InlineGrid, InlineStack, Page, Pagination, Text, TextField } from "@shopify/polaris";
import { CatalogFilterBar } from "@/components/merchant/CatalogFilterBar";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { planReorder, STATUS_LABEL, type StockStatus } from "@/lib/merchant/reorder";
import type { CatalogFilter } from "@/lib/merchant/types";
import { useCatalog } from "@/lib/merchant/useCatalog";
import { loadSalesPageAction } from "./actions";

const LOOKBACKS = [
  { label: "Last 30 days", value: "30" },
  { label: "Last 60 days", value: "60" },
  { label: "Last 90 days", value: "90" },
];
// 150 pages × 20 orders: a sensible ceiling so a huge shop can't keep this running for an hour.
const MAX_ORDER_PAGES = 150;
const PAGE_SIZE = 50;
const DAY_MS = 86_400_000;

const TONE: Record<StockStatus, "critical" | "attention" | "success" | "info"> = { out: "critical", urgent: "critical", soon: "attention", ok: "success", dead: "info" };

const parseDays = (text: string, fallback: number): number => {
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? Math.min(365, Math.round(value)) : fallback;
};

export function ReorderPlanner() {
  const catalog = useCatalog();
  const [filter, setFilter] = useState<CatalogFilter>({});
  const [lookback, setLookback] = useState("30");
  const [leadText, setLeadText] = useState("14");
  const [coverText, setCoverText] = useState("30");
  const [sold, setSold] = useState<Map<string, number>>(new Map());
  const [salesState, setSalesState] = useState<{ running: boolean; orders: number; capped: boolean; error: string | null; done: boolean }>({ running: false, orders: 0, capped: false, error: null, done: false });
  const [active, setActive] = useState<StockStatus | null>(null);
  const [page, setPage] = useState(0);
  const stopRef = useRef(false);

  const params = useMemo(() => ({ lookbackDays: Number(lookback), leadTimeDays: parseDays(leadText, 14), coverDays: parseDays(coverText, 30) }), [lookback, leadText, coverText]);
  const plan = useMemo(() => planReorder(catalog.rows, sold, params), [catalog.rows, sold, params]);

  const counts = useMemo(() => {
    const tally: Record<StockStatus, number> = { out: 0, urgent: 0, soon: 0, ok: 0, dead: 0 };
    for (const entry of plan) tally[entry.status] += 1;
    return tally;
  }, [plan]);

  const visible = active ? plan.filter((entry) => entry.status === active) : plan;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const shown = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const toOrder = plan.filter((entry) => entry.suggested > 0);
  const working = catalog.loading || salesState.running;

  const analyze = async () => {
    stopRef.current = false;
    setPage(0);
    setActive(null);
    setSold(new Map());
    setSalesState({ running: true, orders: 0, capped: false, error: null, done: false });
    // The stock comes from the catalog; the rates come from the orders in the chosen window.
    const sinceIso = new Date(Date.now() - Number(lookback) * DAY_MS).toISOString();
    const totals = new Map<string, number>();
    let cursor: string | null = null;
    let orders = 0;
    let pages = 0;
    const catalogLoad = catalog.load(filter);
    do {
      const response: Awaited<ReturnType<typeof loadSalesPageAction>> = await loadSalesPageAction(cursor, sinceIso).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
      if (!response.ok) {
        setSalesState({ running: false, orders, capped: false, error: response.error, done: true });
        await catalogLoad;
        return;
      }
      for (const [variantId, units] of Object.entries(response.sold)) totals.set(variantId, (totals.get(variantId) ?? 0) + units);
      orders += response.orders;
      pages += 1;
      cursor = response.nextCursor;
      setSold(new Map(totals));
      setSalesState({ running: true, orders, capped: false, error: null, done: false });
    } while (cursor && pages < MAX_ORDER_PAGES && !stopRef.current);
    await catalogLoad;
    setSalesState({ running: false, orders, capped: cursor !== null && !stopRef.current, error: null, done: true });
  };

  const exportCsv = (entries: typeof plan, name: string) =>
    downloadCsv(
      buildCsv(
        ["SKU", "Product", "Variant", "Vendor", "In stock", `Sold (${lookback}d)`, "Sold per day", "Days left", "Suggested order", "Status"],
        entries.map((e) => [e.row.sku, e.row.productTitle, e.row.variantTitle, e.row.vendor, String(e.stock), String(e.sold), e.perDay.toFixed(2), Number.isFinite(e.daysLeft) ? String(Math.floor(e.daysLeft)) : "", String(e.suggested), STATUS_LABEL[e.status]]),
      ),
      name,
    );

  return (
    <Page fullWidth title="Reorder planner" subtitle="See what is about to sell out, how many days of stock are left, and how much to order from each supplier.">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">1. Which products, and how do you restock?</Text>
            <CatalogFilterBar filter={filter} onChange={setFilter} onLoad={() => void analyze()} onStop={() => { stopRef.current = true; catalog.stop(); }} loading={working} loadedCount={catalog.rows.length} loadLabel="Analyze stock & sales" hint="Reads your stock and recent orders. Leave the filters empty to plan everything." />
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <Select label="Sales window" options={LOOKBACKS} value={lookback} onChange={setLookback} disabled={working} />
              <TextField label="Supplier lead time" value={leadText} onChange={setLeadText} suffix="days" autoComplete="off" inputMode="numeric" disabled={working} helpText="Days from ordering to stock arriving." />
              <TextField label="Cover each order for" value={coverText} onChange={setCoverText} suffix="days" autoComplete="off" inputMode="numeric" disabled={working} helpText="How long the new stock should last." />
            </InlineGrid>
            {catalog.error && <Banner tone="critical"><p>{catalog.error}</p></Banner>}
            {salesState.error && <Banner tone="critical"><p>{`Couldn't read orders: ${salesState.error}`}</p></Banner>}
            {salesState.running && <Text as="p" tone="subdued">{`Read ${salesState.orders.toLocaleString()} orders so far…`}</Text>}
            {salesState.capped && <Banner tone="warning"><p>{`Only the newest ${salesState.orders.toLocaleString()} orders in the window were read, so very high sellers may be under-counted.`}</p></Banner>}
          </BlockStack>
        </Card>

        {salesState.done && !salesState.error && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{`${plan.length.toLocaleString()} tracked variants · based on ${salesState.orders.toLocaleString()} orders`}</Text>
                <InlineStack gap="200">
                  <Button onClick={() => exportCsv(toOrder, "reorder-list.csv")} disabled={toOrder.length === 0}>{`Download reorder list (${toOrder.length.toLocaleString()})`}</Button>
                  <Button onClick={() => exportCsv(plan, "stock-plan.csv")} disabled={plan.length === 0}>Download everything</Button>
                </InlineStack>
              </InlineStack>

              <div className="stat-grid">
                {(Object.keys(STATUS_LABEL) as StockStatus[]).map((status) => (
                  <StatTile
                    key={status}
                    label={STATUS_LABEL[status]}
                    value={counts[status]}
                    tone={status === "out" || status === "urgent" ? "critical" : status === "soon" ? "caution" : status === "ok" ? "success" : "neutral"}
                    active={active === status}
                    onClick={() => {
                      setActive(active === status ? null : status);
                      setPage(0);
                    }}
                  />
                ))}
              </div>

              {visible.length === 0 ? (
                <Banner tone="info"><p>Nothing in this view.</p></Banner>
              ) : (
                <>
                  <IndexTable
                    resourceName={{ singular: "variant", plural: "variants" }}
                    itemCount={shown.length}
                    selectable={false}
                    headings={[{ title: "Product" }, { title: "SKU" }, { title: "In stock" }, { title: "Sold" }, { title: "Days left" }, { title: "Order" }, { title: "Status" }]}
                  >
                    {shown.map((entry, index) => (
                      <IndexTable.Row id={entry.row.variantId} key={entry.row.variantId} position={index}>
                        <IndexTable.Cell><Text as="span" truncate>{`${entry.row.productTitle}${entry.row.variantTitle ? ` · ${entry.row.variantTitle}` : ""}`}</Text></IndexTable.Cell>
                        <IndexTable.Cell>{entry.row.sku || "—"}</IndexTable.Cell>
                        <IndexTable.Cell>{entry.stock.toLocaleString()}</IndexTable.Cell>
                        <IndexTable.Cell>{entry.sold.toLocaleString()}</IndexTable.Cell>
                        <IndexTable.Cell>{Number.isFinite(entry.daysLeft) ? Math.floor(entry.daysLeft).toLocaleString() : "∞"}</IndexTable.Cell>
                        <IndexTable.Cell>{entry.suggested > 0 ? <Text as="span" fontWeight="semibold">{entry.suggested.toLocaleString()}</Text> : "—"}</IndexTable.Cell>
                        <IndexTable.Cell><Badge tone={TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge></IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
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
