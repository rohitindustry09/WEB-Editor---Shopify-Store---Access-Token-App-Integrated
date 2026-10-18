"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Banner, BlockStack, Button, Card, IndexTable, InlineGrid, InlineStack, Modal, Page, Text, TextField } from "@shopify/polaris";
import { ProductIcon } from "@shopify/polaris-icons";
import { CatalogFilterBar } from "@/components/merchant/CatalogFilterBar";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { newRunId, runChanges, type ClientChange } from "@/lib/merchant/applyClient";
import { computePrices, describeRule, type PriceMode, type PricePair, type PriceRule, type PriceTarget, type Rounding } from "@/lib/merchant/pricing";
import type { CatalogFilter, CatalogRow, HistoryEntry } from "@/lib/merchant/types";
import { useCatalog } from "@/lib/merchant/useCatalog";

const MODES: { label: string; value: PriceMode; help: string }[] = [
  { label: "Change by a percentage", value: "percent", help: "−20 lowers every price by 20%, 10 raises by 10%." },
  { label: "Change by an amount", value: "amount", help: "−5 takes 5 off every price, 2.5 adds 2.50." },
  { label: "Set to one price", value: "set", help: "Every selected variant gets exactly this price." },
  { label: "Start a sale", value: "sale", help: "Takes the percentage off, and keeps the old price as the compare-at price so the sale shows on the storefront." },
  { label: "End the sale", value: "endSale", help: "Where a compare-at price is higher than the price, restores it as the price and clears the compare-at." },
];
const ROUNDINGS: { label: string; value: Rounding }[] = [
  { label: "No rounding (2 decimals)", value: "none" },
  { label: "End in .99", value: "99" },
  { label: "End in .95", value: "95" },
  { label: "Whole number", value: "whole" },
];
const TARGETS: { label: string; value: PriceTarget }[] = [
  { label: "Price", value: "price" },
  { label: "Compare-at price", value: "compareAt" },
];
const PREVIEW_ROWS = 100;

interface Planned {
  row: CatalogRow;
  next: PricePair;
}

const label = (row: CatalogRow): string => `${row.productTitle}${row.variantTitle ? ` · ${row.variantTitle}` : ""}${row.sku ? ` (${row.sku})` : ""}`;

/** Groups the planned changes by product (Shopify updates a product's variants in one call). */
function toChanges(planned: Planned[]): ClientChange[] {
  const byProduct = new Map<string, Planned[]>();
  for (const entry of planned) byProduct.set(entry.row.productId, [...(byProduct.get(entry.row.productId) ?? []), entry]);
  const changes: ClientChange[] = [];
  for (const [productId, entries] of byProduct) {
    for (let index = 0; index < entries.length; index += 100) {
      const slice = entries.slice(index, index + 100);
      const history: HistoryEntry[] = slice.map(({ row, next }) => ({
        kind: "variantPrice",
        productId,
        variantId: row.variantId,
        label: label(row),
        before: { price: row.price, compareAtPrice: row.compareAtPrice },
        after: next,
      }));
      changes.push({
        key: `${productId}#${index}`,
        item: { kind: "variantPrice", productId, variants: slice.map(({ row, next }) => ({ id: row.variantId, price: next.price, compareAtPrice: next.compareAtPrice })) },
        entries: history,
      });
    }
  }
  return changes;
}

export function PriceEditor() {
  const catalog = useCatalog();
  const [filter, setFilter] = useState<CatalogFilter>({});
  const [rule, setRule] = useState<PriceRule>({ mode: "percent", value: -10, target: "price", rounding: "none", floor: 0 });
  const [valueText, setValueText] = useState("-10");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const [finished, setFinished] = useState<{ changed: number; failed: number } | null>(null);
  const stopRef = useRef(false);

  const planned = useMemo<Planned[]>(() => {
    const result: Planned[] = [];
    for (const row of catalog.rows) {
      const next = computePrices(row, rule);
      if (next) result.push({ row, next });
    }
    return result;
  }, [catalog.rows, rule]);

  const mode = MODES.find((m) => m.value === rule.mode) ?? MODES[0];
  const needsValue = rule.mode !== "endSale";
  const needsTarget = rule.mode === "percent" || rule.mode === "amount" || rule.mode === "set";
  const needsRounding = rule.mode !== "endSale";

  const setValue = (text: string) => {
    setValueText(text);
    const parsed = Number(text);
    setRule((prev) => ({ ...prev, value: Number.isFinite(parsed) ? parsed : 0 }));
  };

  const valueProblem = !needsValue
    ? null
    : valueText.trim() === "" || !Number.isFinite(Number(valueText))
      ? "Enter a number."
      : rule.mode === "sale" && (rule.value <= 0 || rule.value >= 100)
        ? "A sale percentage must be between 0 and 100."
        : rule.mode === "percent" && rule.value <= -100
          ? "A change of −100% or more would take the price to zero or below."
        : rule.mode === "set" && rule.value < 0
          ? "A price can't be negative."
          : null;

  const apply = async () => {
    setConfirmOpen(false);
    stopRef.current = false;
    setErrors([]);
    setFinished(null);
    const changes = toChanges(planned);
    setRunning(true);
    setProgress({ done: 0, total: planned.length, failed: 0 });
    let failedVariants = 0;
    let changedVariants = 0;
    const sizeOf = new Map(changes.map((change) => [change.key, change.entries?.length ?? 0]));
    const entriesOf = new Map(changes.map((change) => [change.key, change.entries ?? []]));
    await runChanges(changes, {
      history: { runId: newRunId(), tool: "Bulk price editor", label: `${describeRule(rule)} · ${planned.length} variants` },
      shouldStop: () => stopRef.current,
      onOutcomes: (outcomes) => {
        let done = 0;
        let failed = 0;
        for (const { key, outcome } of outcomes) {
          const size = sizeOf.get(key) ?? 0;
          done += size;
          if (outcome.ok) {
            changedVariants += size;
            const patches = new Map<string, Partial<CatalogRow>>();
            for (const entry of entriesOf.get(key) ?? []) {
              if (entry.kind === "variantPrice") patches.set(entry.variantId, { price: entry.after.price, compareAtPrice: entry.after.compareAtPrice });
            }
            catalog.patchRows(patches);
          } else {
            failed += size;
            failedVariants += size;
            setErrors((prev) => (prev.length < 20 ? [...prev, outcome.error ?? "A change failed."] : prev));
          }
        }
        setProgress((prev) => ({ ...prev, done: prev.done + done, failed: prev.failed + failed }));
      },
    });
    setRunning(false);
    setFinished({ changed: changedVariants, failed: failedVariants });
  };

  const skipped = catalog.rows.length - planned.length;

  return (
    <Page fullWidth title="Bulk price editor" subtitle="Change prices across many products at once, preview every change, and undo the whole run later.">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">1. Which products?</Text>
            <CatalogFilterBar
              filter={filter}
              onChange={setFilter}
              onLoad={() => void catalog.load(filter)}
              onStop={catalog.stop}
              loading={catalog.loading}
              loadedCount={catalog.rows.length}
            />
            {catalog.error && <Banner tone="critical"><p>{catalog.error}</p></Banner>}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">2. What change?</Text>
            <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="300">
              <Select label="Type of change" options={MODES} value={rule.mode} onChange={(value) => setRule((prev) => ({ ...prev, mode: value as PriceMode }))} disabled={running} />
              {needsValue && (
                <TextField
                  label={rule.mode === "percent" || rule.mode === "sale" ? "Percent" : rule.mode === "amount" ? "Amount" : "Price"}
                  value={valueText}
                  onChange={setValue}
                  autoComplete="off"
                  inputMode="decimal"
                  suffix={rule.mode === "percent" || rule.mode === "sale" ? "%" : undefined}
                  error={valueProblem ?? undefined}
                  disabled={running}
                />
              )}
              {needsTarget && <Select label="Change the" options={TARGETS} value={rule.target} onChange={(value) => setRule((prev) => ({ ...prev, target: value as PriceTarget }))} disabled={running} />}
              {needsRounding && <Select label="Rounding" options={ROUNDINGS} value={rule.rounding} onChange={(value) => setRule((prev) => ({ ...prev, rounding: value as Rounding }))} disabled={running} />}
              {needsValue && (
                <TextField
                  label="Never go below"
                  value={rule.floor === 0 ? "" : String(rule.floor)}
                  onChange={(text) => setRule((prev) => ({ ...prev, floor: Number.isFinite(Number(text)) ? Math.max(0, Number(text)) : 0 }))}
                  autoComplete="off"
                  inputMode="decimal"
                  placeholder="No floor"
                  disabled={running}
                />
              )}
            </InlineGrid>
            <Text as="p" tone="subdued">{mode.help}</Text>
          </BlockStack>
        </Card>

        {catalog.rows.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">3. Preview</Text>
              <div className="stat-grid">
                <StatTile label="Variants loaded" value={catalog.rows.length} icon={ProductIcon} />
                <StatTile label="Will change" value={planned.length} tone="success" />
                <StatTile label="Left as they are" value={skipped} tone="neutral" />
                {running || finished ? <StatTile label="Failed" value={progress.failed} tone={progress.failed > 0 ? "critical" : "neutral"} /> : null}
              </div>

              {planned.length === 0 ? (
                <Banner tone="info"><p>This rule wouldn&apos;t change any of the loaded variants.</p></Banner>
              ) : (
                <IndexTable
                  resourceName={{ singular: "change", plural: "changes" }}
                  itemCount={Math.min(planned.length, PREVIEW_ROWS)}
                  selectable={false}
                  headings={[{ title: "Product" }, { title: "SKU" }, { title: "Price" }, { title: "Compare-at" }]}
                >
                  {planned.slice(0, PREVIEW_ROWS).map(({ row, next }, index) => (
                    <IndexTable.Row id={row.variantId} key={row.variantId} position={index}>
                      <IndexTable.Cell>
                        <Text as="span" truncate>{`${row.productTitle}${row.variantTitle ? ` · ${row.variantTitle}` : ""}`}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{row.sku || "—"}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span">{row.price} → </Text>
                        <Badge tone={Number(next.price) < Number(row.price) ? "success" : Number(next.price) > Number(row.price) ? "attention" : undefined}>{next.price}</Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{`${row.compareAtPrice ?? "—"} → ${next.compareAtPrice ?? "—"}`}</IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
              {planned.length > PREVIEW_ROWS && <Text as="p" tone="subdued">{`Showing the first ${PREVIEW_ROWS} of ${planned.length.toLocaleString()} changes — all of them are applied.`}</Text>}

              <InlineStack gap="300" blockAlign="center">
                <Button variant="primary" disabled={running || planned.length === 0 || valueProblem !== null} onClick={() => setConfirmOpen(true)}>
                  {`Apply to ${planned.length.toLocaleString()} variants`}
                </Button>
                {running && <Button tone="critical" onClick={() => { stopRef.current = true; }}>Stop</Button>}
                {running && <Text as="span" tone="subdued">{`${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} done`}</Text>}
              </InlineStack>

              {finished && (
                <Banner tone={finished.failed === 0 ? "success" : "warning"} title={finished.failed === 0 ? "Prices updated" : "Finished with problems"}>
                  <p>{`${finished.changed.toLocaleString()} variants changed · ${finished.failed.toLocaleString()} failed. `}<Link href="/merchant/history">Open the change history</Link> to undo this run.</p>
                  {errors.length > 0 && <p>{`Why: ${errors[0]}`}</p>}
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}
      </BlockStack>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Change ${planned.length.toLocaleString()} variants?`}
        primaryAction={{ content: "Apply changes", onAction: () => void apply() }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">{`${describeRule(rule)} — this changes prices in your store right away.`}</Text>
            <Text as="p" tone="subdued">Every old price is saved in the change history, so you can undo this run from there.</Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
