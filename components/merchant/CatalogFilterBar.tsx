"use client";

import { BlockStack, Button, InlineGrid, InlineStack, Text, TextField } from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import type { CatalogFilter } from "@/lib/merchant/types";

const STATUS_OPTIONS = [
  { label: "Any status", value: "" },
  { label: "Active", value: "ACTIVE" },
  { label: "Draft", value: "DRAFT" },
  { label: "Archived", value: "ARCHIVED" },
];

/**
 * The "which products?" row every catalog tool starts with: narrow by tag, vendor, type, status or SKU
 * (all optional, combined with AND), then read the catalog with a live count and a Stop button.
 */
export function CatalogFilterBar({
  filter,
  onChange,
  onLoad,
  onStop,
  loading,
  loadedCount,
  loadLabel = "Load products",
  hint,
}: {
  filter: CatalogFilter;
  onChange: (next: CatalogFilter) => void;
  onLoad: () => void;
  onStop: () => void;
  loading: boolean;
  loadedCount: number;
  loadLabel?: string;
  hint?: string;
}) {
  const set = (patch: Partial<CatalogFilter>) => onChange({ ...filter, ...patch });
  return (
    <BlockStack gap="300">
      <InlineGrid columns={{ xs: 1, sm: 2, lg: 5 }} gap="300">
        <TextField label="Tag" value={filter.tag ?? ""} onChange={(tag) => set({ tag })} autoComplete="off" placeholder="e.g. summer" disabled={loading} />
        <TextField label="Vendor" value={filter.vendor ?? ""} onChange={(vendor) => set({ vendor })} autoComplete="off" disabled={loading} />
        <TextField label="Product type" value={filter.productType ?? ""} onChange={(productType) => set({ productType })} autoComplete="off" disabled={loading} />
        <TextField label="SKU (starts with)" value={filter.sku ?? ""} onChange={(sku) => set({ sku })} autoComplete="off" disabled={loading} />
        <Select label="Status" options={STATUS_OPTIONS} value={filter.status ?? ""} onChange={(status) => set({ status: status as CatalogFilter["status"] })} disabled={loading} />
      </InlineGrid>
      <InlineStack gap="300" blockAlign="center">
        <Button variant="primary" onClick={onLoad} loading={loading} disabled={loading}>
          {loadLabel}
        </Button>
        {loading && <Button onClick={onStop}>Stop</Button>}
        <Text as="span" tone="subdued">
          {loading ? `Read ${loadedCount.toLocaleString()} variants so far…` : loadedCount > 0 ? `${loadedCount.toLocaleString()} variants loaded` : (hint ?? "Leave every field empty to load the whole catalog.")}
        </Text>
      </InlineStack>
    </BlockStack>
  );
}
