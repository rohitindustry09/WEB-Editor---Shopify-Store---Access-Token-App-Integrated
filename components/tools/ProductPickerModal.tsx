"use client";
/* eslint-disable react-hooks/set-state-in-effect -- both effects below reset/repopulate local picker state in response to the modal opening or the search query changing, not deriving state from other rendered state */

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, TextField, Box, BlockStack, InlineStack, Checkbox, Text, Badge, Thumbnail, Spinner, Button, Banner } from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import type { MetafieldCopierProduct } from "@/app/(app)/tools/metafield-copier/actions";

const STATUS_TONE: Record<MetafieldCopierProduct["status"], "success" | "info" | "warning"> = {
  ACTIVE: "success",
  DRAFT: "info",
  ARCHIVED: "warning",
};

interface Props {
  open: boolean;
  onClose: () => void;
  initialSelected: MetafieldCopierProduct[];
  onConfirm: (selected: MetafieldCopierProduct[]) => void;
  excludeId?: string;
  search: (query: string) => Promise<{ ok: boolean; products: MetafieldCopierProduct[]; error?: string }>;
  searchBySkuList: (skus: string[]) => Promise<{ ok: boolean; products: MetafieldCopierProduct[]; error?: string }>;
}

/**
 * Multiselect product picker — search by title/SKU/ID like Shopify's own
 * admin picker, plus a comma-separated SKU paste field for bulk lookups.
 * Selection is local to the modal session; nothing is confirmed until
 * "Select" is pressed, so "Cancel" always discards cleanly.
 */
export function ProductPickerModal({ open, onClose, initialSelected, onConfirm, excludeId, search, searchBySkuList }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetafieldCopierProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [skuListText, setSkuListText] = useState("");
  const [findingSkus, setFindingSkus] = useState(false);
  const [skuLookupError, setSkuLookupError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, MetafieldCopierProduct>>(new Map());

  // Reset to a fresh session — current results, current selection — every
  // time the modal opens, seeded from whatever was already chosen before.
  useEffect(() => {
    if (!open) return;
    setSelected(new Map(initialSelected.map((p) => [p.id, p])));
    setQuery("");
    setSkuListText("");
    setSkuLookupError(null);
  }, [open, initialSelected]);

  const searchIdRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const requestId = ++searchIdRef.current;
    setSearching(true);
    const id = setTimeout(async () => {
      const result = await search(query);
      if (searchIdRef.current !== requestId) return;
      setSearching(false);
      if (result.ok) setResults(result.products.filter((p) => p.id !== excludeId));
    }, 250);
    return () => clearTimeout(id);
  }, [open, query, excludeId, search]);

  const toggle = (product: MetafieldCopierProduct) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, product);
      return next;
    });
  };

  // Whatever's already selected (e.g. seeded from `initialSelected`) stays
  // visible in the list even when it falls outside the current search/browse
  // results — otherwise a pre-checked row could vanish with no way to see
  // or deselect it. Pinned ahead of the live results.
  const visibleProducts = useMemo(() => {
    const resultIds = new Set(results.map((p) => p.id));
    const pinned = Array.from(selected.values()).filter((p) => !resultIds.has(p.id));
    return [...pinned, ...results];
  }, [results, selected]);

  const allShownSelected = visibleProducts.length > 0 && visibleProducts.every((p) => selected.has(p.id));

  const toggleSelectAllShown = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allShownSelected) {
        for (const p of visibleProducts) next.delete(p.id);
      } else {
        for (const p of visibleProducts) next.set(p.id, p);
      }
      return next;
    });
  };

  const findSkus = async () => {
    const skus = skuListText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (skus.length === 0) return;
    setFindingSkus(true);
    setSkuLookupError(null);
    try {
      const result = await searchBySkuList(skus);
      if (!result.ok) {
        setSkuLookupError(result.error ?? "SKU lookup failed.");
        return;
      }
      const found = result.products.filter((p) => p.id !== excludeId);
      const foundSkuSet = new Set(found.map((p) => (p.sku ?? "").toLowerCase()));
      const missing = skus.filter((s) => !foundSkuSet.has(s.toLowerCase()));

      setResults((prev) => {
        const merged = new Map(prev.map((p) => [p.id, p]));
        for (const p of found) merged.set(p.id, p);
        return Array.from(merged.values());
      });
      setSelected((prev) => {
        const next = new Map(prev);
        for (const p of found) next.set(p.id, p);
        return next;
      });
      if (missing.length > 0) {
        setSkuLookupError(`No product found for: ${missing.join(", ")}`);
      }
    } finally {
      setFindingSkus(false);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  const handleSelect = () => {
    onConfirm(Array.from(selected.values()));
    onClose();
  };

  return (
    <Modal open={open} onClose={handleCancel} title="Copy to products" size="large">
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label="Search products"
            labelHidden
            autoComplete="off"
            placeholder="Search by title, SKU, or ID…"
            value={query}
            onChange={setQuery}
            clearButton
            onClearButtonClick={() => setQuery("")}
            autoFocus
          />

          <BlockStack gap="150">
            <TextField
              label="Or paste SKUs, comma-separated"
              autoComplete="off"
              placeholder="SKU-001, SKU-002, SKU-003"
              value={skuListText}
              onChange={setSkuListText}
              connectedRight={
                <Button onClick={findSkus} loading={findingSkus} disabled={!skuListText.trim()}>
                  Find
                </Button>
              }
            />
            {skuLookupError && (
              <Banner tone="warning">
                <p>{skuLookupError}</p>
              </Banner>
            )}
          </BlockStack>

          <InlineStack align="space-between" blockAlign="center">
            <Checkbox
              label={`Select all shown (${visibleProducts.length})`}
              checked={allShownSelected}
              disabled={visibleProducts.length === 0}
              onChange={toggleSelectAllShown}
            />
            <Text as="span" tone="subdued" variant="bodySm">
              {selected.size} selected
            </Text>
          </InlineStack>

          <Box maxWidth="100%" overflowX="hidden">
            <BlockStack gap="0">
              {searching && (
                <Box padding="400">
                  <InlineStack gap="150" blockAlign="center">
                    <Spinner size="small" accessibilityLabel="Searching" />
                    <Text as="span" tone="subdued">Searching…</Text>
                  </InlineStack>
                </Box>
              )}
              {!searching && visibleProducts.length === 0 && (
                <Box padding="400">
                  <Text as="p" tone="subdued">
                    {query.trim() ? `No products match "${query}".` : "No products found."}
                  </Text>
                </Box>
              )}
              {!searching &&
                visibleProducts.map((product) => (
                  <label
                    key={product.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.5rem 0.25rem",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--p-color-border)",
                    }}
                  >
                    <Checkbox label="" labelHidden checked={selected.has(product.id)} onChange={() => toggle(product)} />
                    <Thumbnail source={product.imageUrl ?? ImageIcon} alt={product.title} size="small" />
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Text as="span" fontWeight="medium">{product.title}</Text>
                      {product.sku && (
                        <Text as="span" tone="subdued" variant="bodySm">{product.sku}</Text>
                      )}
                      <Badge tone={STATUS_TONE[product.status]} size="small">
                        {product.status.charAt(0) + product.status.slice(1).toLowerCase()}
                      </Badge>
                    </InlineStack>
                  </label>
                ))}
            </BlockStack>
          </Box>
        </BlockStack>
      </Modal.Section>
      <Modal.Section>
        <InlineStack align="end" gap="200">
          <Button onClick={handleCancel}>Cancel</Button>
          <Button variant="primary" onClick={handleSelect} disabled={selected.size === 0}>
            {`Select${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </Button>
        </InlineStack>
      </Modal.Section>
    </Modal>
  );
}
