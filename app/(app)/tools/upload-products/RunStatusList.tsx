"use client";

import { useMemo, useState } from "react";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { StatTile } from "@/components/ui/StatTile";
import { Badge, BlockStack, Button, ButtonGroup, Checkbox, IndexTable, InlineStack, Pagination, ProgressBar, Spinner, Text } from "@shopify/polaris";

const PAGE_SIZE = 25;

export type RowState = "waiting" | "running" | "done" | "skipped" | "failed";

export interface RowStatus {
  state: RowState;
  /** Shopify's error for a failed row, or a remark for a finished one. */
  message?: string;
}

export interface RunRow {
  /** Unique key of the row (the SKU — or `SKU#productId` for one of several products sharing a SKU). */
  sku: string;
  /** What the SKU column shows when it differs from the key. */
  label?: string;
  title: string;
  action: "Update" | "Create" | "Finish creating";
}

type Filter = "all" | RowState;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Waiting" },
  { value: "running", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "skipped", label: "Up to date" },
  { value: "failed", label: "Failed" },
];


/**
 * Live totals for the run, SKU by SKU: how many are done out of the total, split
 * into updated / created / failed, with what is uploading right now and what is
 * still waiting. Recomputed from the per-SKU statuses, so it moves as each product finishes.
 */
export function RunSummary({ rows, statuses, running }: { rows: RunRow[]; statuses: Record<string, RowStatus>; running: boolean }) {
  const tally = { updated: 0, created: 0, skipped: 0, failed: 0, running: 0, waiting: 0 };
  for (const row of rows) {
    const state = statuses[row.sku]?.state ?? "waiting";
    if (state === "done") tally[row.action === "Create" ? "created" : "updated"] += 1;
    else tally[state] += 1;
  }
  const total = rows.length;
  const finished = tally.updated + tally.created + tally.skipped + tally.failed;
  const percent = total > 0 ? (finished / total) * 100 : 0;
  const succeeded = tally.updated + tally.created;

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="end" gap="300">
        <Text as="h4" variant="headingMd">
          <AnimatedNumber value={succeeded} durationMs={450} /> of {total.toLocaleString()} products uploaded & updated
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {`${finished.toLocaleString()} of ${total.toLocaleString()} processed · ${percent.toFixed(percent >= 10 || percent === 0 ? 0 : 1)}%${running ? "" : " — finished"}`}
        </Text>
      </InlineStack>
      <ProgressBar progress={percent} tone={tally.failed > 0 && !running ? "critical" : "primary"} size="small" />
      <div className="stat-grid">
        <StatTile label="Total to process" value={total} tone="neutral" />
        <StatTile label="Updated" value={tally.updated} tone="success" />
        <StatTile label="Created (new)" value={tally.created} tone="success" />
        <StatTile label="Already up to date (skipped)" value={tally.skipped} tone="neutral" />
        <StatTile label="Uploading now" value={tally.running} tone="info" />
        <StatTile label="Waiting" value={tally.waiting} tone="caution" />
        <StatTile label="Failed" value={tally.failed} tone="critical" />
      </div>
    </BlockStack>
  );
}

function StateBadge({ state }: { state: RowState }) {
  if (state === "running") {
    return (
      <InlineStack gap="150" blockAlign="center" wrap={false}>
        <Spinner size="small" accessibilityLabel="Uploading" />
        <Badge tone="info">Uploading…</Badge>
      </InlineStack>
    );
  }
  if (state === "done") return <Badge tone="success" progress="complete">Done</Badge>;
  if (state === "skipped") return <Badge tone="attention">Up to date</Badge>;
  if (state === "failed") return <Badge tone="critical" progress="incomplete">Failed</Badge>;
  return <Badge>Waiting</Badge>;
}

/**
 * Every product in the run, SKU by SKU, with its status updating live as each
 * one is uploaded or updated. While a run is going the list follows the product
 * currently being processed; switch that off to browse freely.
 */
export function RunStatusList({
  rows,
  statuses,
  running,
  currentSku,
  onRetry,
}: {
  rows: RunRow[];
  statuses: Record<string, RowStatus>;
  running: boolean;
  currentSku: string | null;
  /** Re-runs just these SKUs; shown as Retry buttons on failed rows. */
  onRetry?: (skus: string[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [follow, setFollow] = useState(true);

  const stateOf = (sku: string): RowState => statuses[sku]?.state ?? "waiting";

  const counts = useMemo(() => {
    const tally: Record<Filter, number> = { all: rows.length, waiting: 0, running: 0, done: 0, skipped: 0, failed: 0 };
    for (const row of rows) tally[statuses[row.sku]?.state ?? "waiting"] += 1;
    return tally;
  }, [rows, statuses]);

  const filtered = filter === "all" ? rows : rows.filter((row) => stateOf(row.sku) === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentIndex = currentSku ? filtered.findIndex((row) => row.sku === currentSku) : -1;
  const following = running && follow && filter === "all" && currentIndex >= 0;
  const activePage = Math.min(following ? Math.floor(currentIndex / PAGE_SIZE) : page, pageCount - 1);
  const visible = filtered.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  const firstShown = filtered.length === 0 ? 0 : activePage * PAGE_SIZE + 1;
  const lastShown = Math.min((activePage + 1) * PAGE_SIZE, filtered.length);

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <BlockStack gap="050">
          <Text as="h4" variant="headingSm">{`Products in this run (${rows.length.toLocaleString()})`}</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {running
              ? `${counts.done.toLocaleString()} done · ${counts.failed.toLocaleString()} failed · ${counts.waiting.toLocaleString()} waiting`
              : "Each product shows its status here live while Upload & Update runs."}
          </Text>
        </BlockStack>
        <InlineStack gap="300" blockAlign="center">
          {onRetry && !running && counts.failed > 0 && (
            <Button variant="primary" tone="critical" onClick={() => onRetry(rows.filter((row) => stateOf(row.sku) === "failed").map((row) => row.sku))}>
              {`Retry ${counts.failed.toLocaleString()} failed`}
            </Button>
          )}
          {running && <Checkbox label="Follow progress" checked={follow} onChange={setFollow} />}
        </InlineStack>
      </InlineStack>

      <ButtonGroup variant="segmented">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            pressed={filter === option.value}
            onClick={() => {
              setFilter(option.value);
              setPage(0);
            }}
          >
            {`${option.label} (${counts[option.value].toLocaleString()})`}
          </Button>
        ))}
      </ButtonGroup>

      <IndexTable
        resourceName={{ singular: "product", plural: "products" }}
        itemCount={visible.length}
        selectable={false}
        headings={[{ title: "#" }, { title: "SKU" }, { title: "Product" }, { title: "Action" }, { title: "Status" }, { title: "Details" }]}
      >
        {visible.map((row, index) => {
          const status = statuses[row.sku];
          return (
            <IndexTable.Row id={row.sku} key={row.sku} position={index} tone={status?.state === "failed" ? "critical" : status?.state === "running" ? "subdued" : undefined}>
              <IndexTable.Cell>
                <Text as="span" tone="subdued">{(activePage * PAGE_SIZE + index + 1).toLocaleString()}</Text>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" fontWeight="semibold">{row.label ?? row.sku}</Text>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" truncate>{row.title || "—"}</Text>
              </IndexTable.Cell>
              <IndexTable.Cell>{row.action}</IndexTable.Cell>
              <IndexTable.Cell>
                <StateBadge state={status?.state ?? "waiting"} />
              </IndexTable.Cell>
              <IndexTable.Cell>
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone={status?.state === "failed" ? "critical" : "subdued"} breakWord>
                    {status?.message ?? ""}
                  </Text>
                  {onRetry && !running && status?.state === "failed" && (
                    <InlineStack>
                      <Button size="micro" onClick={() => onRetry([row.sku])}>Retry</Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </IndexTable.Cell>
            </IndexTable.Row>
          );
        })}
      </IndexTable>

      <InlineStack align="space-between" blockAlign="center">
        <Text as="span" variant="bodySm" tone="subdued">
          {filtered.length === 0 ? "No products in this view." : `Showing ${firstShown.toLocaleString()}–${lastShown.toLocaleString()} of ${filtered.length.toLocaleString()}`}
        </Text>
        <Pagination
          hasPrevious={activePage > 0}
          hasNext={activePage < pageCount - 1}
          onPrevious={() => {
            setFollow(false);
            setPage(activePage - 1);
          }}
          onNext={() => {
            setFollow(false);
            setPage(activePage + 1);
          }}
        />
      </InlineStack>
    </BlockStack>
  );
}
