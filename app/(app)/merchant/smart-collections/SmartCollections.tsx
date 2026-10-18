"use client";

import { useState } from "react";
import { Banner, BlockStack, Button, Card, InlineGrid, InlineStack, Page, Text, TextField } from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import { Select } from "@/components/ui/Select";
import { LinkTile } from "@/components/ui/LinkTile";
import { idFromGid } from "@/lib/format";
import { createSmartCollectionAction, type CreatedCollection, type SmartRule } from "./actions";

const COLUMN_OPTIONS = [
  { label: "Product tag", value: "TAG" },
  { label: "Product title", value: "TITLE" },
  { label: "Product type", value: "TYPE" },
  { label: "Vendor", value: "VENDOR" },
  { label: "Price", value: "VARIANT_PRICE" },
  { label: "Compare-at price", value: "VARIANT_COMPARE_AT_PRICE" },
  { label: "Stock", value: "VARIANT_INVENTORY" },
  { label: "Weight", value: "VARIANT_WEIGHT" },
  { label: "Variant title", value: "VARIANT_TITLE" },
];
const TEXT_RELATIONS = [
  { label: "is equal to", value: "EQUALS" },
  { label: "is not equal to", value: "NOT_EQUALS" },
  { label: "starts with", value: "STARTS_WITH" },
  { label: "ends with", value: "ENDS_WITH" },
  { label: "contains", value: "CONTAINS" },
  { label: "does not contain", value: "NOT_CONTAINS" },
];
const SET_RELATIONS = [
  { label: "is set (has a value)", value: "IS_SET" },
  { label: "is not set", value: "IS_NOT_SET" },
];
const NUMBER_RELATIONS = [
  { label: "is equal to", value: "EQUALS" },
  { label: "is not equal to", value: "NOT_EQUALS" },
  { label: "is greater than", value: "GREATER_THAN" },
  { label: "is less than", value: "LESS_THAN" },
];
const NUMERIC = new Set(["VARIANT_PRICE", "VARIANT_COMPARE_AT_PRICE", "VARIANT_INVENTORY", "VARIANT_WEIGHT"]);

interface Preset {
  name: string;
  title: string;
  matchAny: boolean;
  rules: SmartRule[];
  text: string;
}

const PRESETS: Preset[] = [
  { name: "On sale", title: "On sale", matchAny: false, rules: [{ column: "VARIANT_COMPARE_AT_PRICE", relation: "IS_SET", condition: "" }], text: "Every product with a compare-at price — the ones showing a strike-through price." },
  { name: "In stock", title: "In stock", matchAny: false, rules: [{ column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" }], text: "Products with stock available." },
  { name: "Low stock", title: "Last few left", matchAny: false, rules: [{ column: "VARIANT_INVENTORY", relation: "LESS_THAN", condition: "5" }, { column: "VARIANT_INVENTORY", relation: "GREATER_THAN", condition: "0" }], text: "Under 5 left, but not sold out — good for urgency banners." },
  { name: "New arrivals", title: "New arrivals", matchAny: false, rules: [{ column: "TAG", relation: "EQUALS", condition: "new" }], text: "Everything you tag “new”; drop the tag and it leaves by itself." },
  { name: "Under 25", title: "Under 25", matchAny: false, rules: [{ column: "VARIANT_PRICE", relation: "LESS_THAN", condition: "25" }], text: "Budget picks, kept current as prices change." },
];

const noValue = (rule: SmartRule): boolean => rule.relation === "IS_SET" || rule.relation === "IS_NOT_SET";
const relationsFor = (column: string) => (column === "VARIANT_COMPARE_AT_PRICE" ? [...NUMBER_RELATIONS, ...SET_RELATIONS] : NUMERIC.has(column) ? NUMBER_RELATIONS : TEXT_RELATIONS);

export function SmartCollections({ shopDomain }: { shopDomain: string }) {
  const [title, setTitle] = useState("");
  const [matchAny, setMatchAny] = useState(false);
  const [rules, setRules] = useState<SmartRule[]>([{ column: "TAG", relation: "EQUALS", condition: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCollection[]>([]);

  const patch = (index: number, change: Partial<SmartRule>) => setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...change } : rule)));
  const changeColumn = (index: number, column: string) =>
    patch(index, { column, relation: NUMERIC.has(column) ? "GREATER_THAN" : "EQUALS", condition: "" });

  const applyPreset = (preset: Preset) => {
    setTitle(preset.title);
    setMatchAny(preset.matchAny);
    setRules(preset.rules);
    setError(null);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    const result = await createSmartCollectionAction(title, matchAny, rules).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated((prev) => [result.collection, ...prev]);
    setTitle("");
  };

  return (
    <Page fullWidth title="Smart collections" subtitle="Collections that fill and empty themselves: set the rules once and Shopify keeps them current as products, prices and stock change.">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Start from a ready-made rule set</Text>
            <div className="bento">
              {PRESETS.map((preset) => (
                <button key={preset.name} type="button" className="bento-tile bento-span-4" style={{ textAlign: "left", cursor: "pointer", border: "none", font: "inherit" }} onClick={() => applyPreset(preset)}>
                  <Text as="h3" variant="headingSm">{preset.name}</Text>
                  <Text as="p" tone="subdued">{preset.text}</Text>
                </button>
              ))}
            </div>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Rules</Text>
            <TextField label="Collection name" value={title} onChange={setTitle} autoComplete="off" placeholder="e.g. Summer sale" disabled={busy} />
            <Select
              label="Products must match"
              options={[{ label: "all of the rules (AND)", value: "all" }, { label: "any of the rules (OR)", value: "any" }]}
              value={matchAny ? "any" : "all"}
              onChange={(value) => setMatchAny(value === "any")}
              disabled={busy}
            />

            {rules.map((rule, index) => (
              <InlineGrid key={index} columns={{ xs: 1, md: ["oneThird", "oneThird", "oneThird"] }} gap="300">
                <Select label="Where the" options={COLUMN_OPTIONS} value={rule.column} onChange={(value) => changeColumn(index, value)} disabled={busy} />
                <Select label="Condition" options={relationsFor(rule.column)} value={rule.relation} onChange={(value) => patch(index, { relation: value })} disabled={busy} />
                <InlineStack gap="200" blockAlign="end" wrap={false}>
                  {!noValue(rule) && (
                    <div style={{ flex: 1 }}>
                      <TextField label="Value" value={rule.condition} onChange={(value) => patch(index, { condition: value })} autoComplete="off" inputMode={NUMERIC.has(rule.column) ? "decimal" : "text"} disabled={busy} />
                    </div>
                  )}
                  {rules.length > 1 && <Button icon={DeleteIcon} accessibilityLabel="Remove rule" onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))} disabled={busy} />}
                </InlineStack>
              </InlineGrid>
            ))}

            <InlineStack gap="300" blockAlign="center">
              <Button icon={PlusIcon} onClick={() => setRules((prev) => [...prev, { column: "TAG", relation: "EQUALS", condition: "" }])} disabled={busy}>Add a rule</Button>
              <Button variant="primary" onClick={() => void create()} loading={busy} disabled={busy || !title.trim()}>Create smart collection</Button>
            </InlineStack>
            {error && <Banner tone="critical"><p>{error}</p></Banner>}
          </BlockStack>
        </Card>

        {created.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Created this session</Text>
              <div className="bento">
                {created.map((collection) => (
                  <LinkTile key={collection.id} className="bento-span-4" href={`https://${shopDomain}/admin/collections/${idFromGid(collection.id)}`} title={collection.title} text="Open in Shopify admin to see which products it picked up." icon={PlusIcon} color="emerald" />
                ))}
              </div>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
