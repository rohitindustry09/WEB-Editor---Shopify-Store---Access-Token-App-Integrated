"use client";
/* eslint-disable react-hooks/set-state-in-effect -- each effect below loads data in response to a selection changing (source product, chosen metafield) rather than deriving state from other rendered state */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  Banner,
  Autocomplete,
  Box,
  Thumbnail,
  Badge,
  Spinner,
} from "@shopify/polaris";
import { ImageIcon, XCircleIcon, FileIcon } from "@shopify/polaris-icons";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ProductPickerModal } from "@/components/tools/ProductPickerModal";
import {
  getMetafieldDefinitionsAction,
  getSourceProductAction,
  getSourceMetafieldValueAction,
  searchProductsForCopierAction,
  findProductsBySkuListAction,
  getProductsByIdsAction,
  copyMetafieldToProductAction,
  type MetafieldDefinitionSummary,
  type SourceProductSummary,
  type ProductMetafieldValue,
  type MetafieldCopierProduct,
} from "./actions";

const STATUS_TONE: Record<MetafieldCopierProduct["status"], "success" | "info" | "warning"> = {
  ACTIVE: "success",
  DRAFT: "info",
  ARCHIVED: "warning",
};

function statusLabel(status: MetafieldCopierProduct["status"]): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

type RowCopyStatus = { state: "idle" | "pending" | "done" | "error"; message?: string };

const CONCURRENCY = 5;

export function MetafieldCopierForm() {
  // --- Step 1: source product ---
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceOptions, setSourceOptions] = useState<MetafieldCopierProduct[]>([]);
  const [sourceSearching, setSourceSearching] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(null);
  const [sourceProduct, setSourceProduct] = useState<SourceProductSummary | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const sourceSearchIdRef = useRef(0);
  useEffect(() => {
    if (sourceProduct) return; // no need to keep searching once one's picked
    const requestId = ++sourceSearchIdRef.current;
    setSourceSearching(true);
    const id = setTimeout(async () => {
      const result = await searchProductsForCopierAction(sourceQuery);
      if (sourceSearchIdRef.current !== requestId) return;
      setSourceSearching(false);
      if (result.ok) {
        setSourceSearchError(null);
        setSourceOptions(result.products);
      } else {
        setSourceSearchError(result.error ?? "Search failed.");
        setSourceOptions([]);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [sourceQuery, sourceProduct]);

  const selectSourceProduct = async (id: string) => {
    setSourceLoading(true);
    setSourceError(null);
    const result = await getSourceProductAction(id);
    setSourceLoading(false);
    if (!result.ok || !result.product) {
      setSourceError(result.error ?? "Couldn't load this product.");
      return;
    }
    setSourceProduct(result.product);
    setSelectedDefinitionId(null);
    setMetafieldValue(null);
  };

  const changeSourceProduct = () => {
    setSourceProduct(null);
    setSourceQuery("");
    setSourceOptions([]);
    setSelectedDefinitionId(null);
    setMetafieldValue(null);
  };

  // --- Step 2: metafield definition + its value on the source product ---
  const [definitions, setDefinitions] = useState<MetafieldDefinitionSummary[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(true);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const [metafieldValue, setMetafieldValue] = useState<ProductMetafieldValue | null>(null);
  const [valueLoading, setValueLoading] = useState(false);
  const [valueError, setValueError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await getMetafieldDefinitionsAction();
      setDefinitionsLoading(false);
      if (!result.ok) {
        setDefinitionsError(result.error ?? "Couldn't load metafield definitions.");
        return;
      }
      setDefinitions(result.definitions);
    })();
  }, []);

  const selectedDefinition = definitions.find((d) => d.id === selectedDefinitionId) ?? null;

  // Search field for step 2 — everything's already loaded, so this filters
  // locally by namespace, key, or display name rather than round-tripping.
  const [metafieldQuery, setMetafieldQuery] = useState("");
  const filteredDefinitions = useMemo(() => {
    const q = metafieldQuery.trim().toLowerCase();
    if (!q) return definitions;
    return definitions.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.namespace.toLowerCase().includes(q) ||
        d.key.toLowerCase().includes(q) ||
        `${d.namespace}.${d.key}`.toLowerCase().includes(q),
    );
  }, [definitions, metafieldQuery]);
  const metafieldAutocompleteOptions = filteredDefinitions.map((d) => ({
    value: d.id,
    label: `${d.namespace}.${d.key} — ${d.name}`,
  }));

  const chooseDefinition = (id: string) => {
    setSelectedDefinitionId(id);
    setMetafieldQuery("");
  };

  const changeDefinition = () => {
    setSelectedDefinitionId(null);
    setMetafieldValue(null);
    setMetafieldQuery("");
  };

  useEffect(() => {
    if (!sourceProduct || !selectedDefinition) return;
    setValueLoading(true);
    setValueError(null);
    setMetafieldValue(null);
    (async () => {
      const result = await getSourceMetafieldValueAction(sourceProduct.id, selectedDefinition.namespace, selectedDefinition.key);
      setValueLoading(false);
      if (!result.ok) {
        setValueError(result.error ?? "Couldn't load this metafield's value.");
        return;
      }
      setMetafieldValue(result.value);
    })();
  }, [sourceProduct, selectedDefinition]);

  // --- Step 3: target products + copy ---
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<MetafieldCopierProduct[]>([]);
  const [targetStatus, setTargetStatus] = useState<Record<string, RowCopyStatus>>({});
  const [copying, setCopying] = useState(false);
  const [copyProgress, setCopyProgress] = useState<{ done: number; total: number } | null>(null);
  const [loadingReferencedTargets, setLoadingReferencedTargets] = useState(false);
  const cancelledRef = useRef(false);

  const handlePickerConfirm = (products: MetafieldCopierProduct[]) => {
    setSelectedTargets(products);
    setTargetStatus({});
  };

  // A `product_reference`/`list.product_reference` metafield already names
  // its targets — this is the shortcut for "copy this same list to every
  // product it points to": pre-load them as the picker's starting selection
  // rather than making the user search each one back up by hand.
  const isProductReference = Boolean(selectedDefinition?.typeName.includes("product_reference"));
  const openPickerWithReferencedProducts = async () => {
    if (!metafieldValue) return;
    setLoadingReferencedTargets(true);
    try {
      const result = await getProductsByIdsAction(metafieldValue.referencedItems.map((item) => item.id));
      if (result.ok) {
        setSelectedTargets(result.products.filter((p) => p.id !== sourceProduct?.id));
        setTargetStatus({});
      }
    } finally {
      setLoadingReferencedTargets(false);
      setPickerOpen(true);
    }
  };

  const removeTarget = (id: string) => {
    setSelectedTargets((prev) => prev.filter((p) => p.id !== id));
    setTargetStatus((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const copyToProducts = async () => {
    if (!sourceProduct || !selectedDefinition || !metafieldValue) return;
    cancelledRef.current = false;
    setCopying(true);
    setCopyProgress({ done: 0, total: selectedTargets.length });
    setTargetStatus(Object.fromEntries(selectedTargets.map((p) => [p.id, { state: "pending" as const }])));

    try {
      await mapWithConcurrency(selectedTargets, CONCURRENCY, async (target) => {
        if (cancelledRef.current) return;
        const result = await copyMetafieldToProductAction(
          target.id,
          selectedDefinition.namespace,
          selectedDefinition.key,
          metafieldValue.type,
          metafieldValue.value,
        );
        setTargetStatus((prev) => ({
          ...prev,
          [target.id]: result.ok ? { state: "done" } : { state: "error", message: result.error },
        }));
        setCopyProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      });
    } finally {
      setCopying(false);
    }
  };

  const cancelCopy = () => {
    cancelledRef.current = true;
  };

  const doneCount = Object.values(targetStatus).filter((s) => s.state === "done").length;
  const errorCount = Object.values(targetStatus).filter((s) => s.state === "error").length;

  const sourceAutocompleteOptions = sourceOptions.map((p) => ({
    value: p.id,
    label: `${p.title}${p.sku ? ` — ${p.sku}` : ""}`,
    media: <Thumbnail source={p.imageUrl ?? ImageIcon} alt={p.title} size="small" />,
  }));

  return (
    <Page
      fullWidth
      title="Metafield copier"
      subtitle="Personal tool — copies one metafield's value from a source product to any products you pick. This does write to your store."
      backAction={{ content: "Store connection", url: "/settings/connection" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">1. Select a source product</Text>

              {sourceError && (
                <Banner tone="critical" title="Couldn't load this product">
                  <p>{sourceError}</p>
                </Banner>
              )}

              {sourceProduct ? (
                <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                  <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                    <InlineStack gap="300" blockAlign="center">
                      <Thumbnail source={sourceProduct.imageUrl ?? ImageIcon} alt={sourceProduct.title} size="medium" />
                      <BlockStack gap="050">
                        <InlineStack gap="150" blockAlign="center">
                          <Text as="span" fontWeight="semibold">{sourceProduct.title}</Text>
                          <Badge tone={STATUS_TONE[sourceProduct.status]}>{statusLabel(sourceProduct.status)}</Badge>
                        </InlineStack>
                        <Text as="span" tone="subdued" variant="bodySm">
                          {sourceProduct.sku ?? "No SKU"} · {sourceProduct.categoryName ?? "No category set"}
                        </Text>
                        <Text as="span" tone="subdued" variant="bodySm">
                          {sourceProduct.description
                            ? sourceProduct.description.length > 160
                              ? `${sourceProduct.description.slice(0, 160)}…`
                              : sourceProduct.description
                            : "No description"}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <Button onClick={changeSourceProduct}>Change product</Button>
                  </InlineStack>
                </Box>
              ) : (
                <BlockStack gap="200">
                  <Autocomplete
                    options={sourceAutocompleteOptions}
                    selected={[]}
                    onSelect={(selected) => selected[0] && selectSourceProduct(selected[0])}
                    loading={sourceSearching || sourceLoading}
                    textField={
                      <Autocomplete.TextField
                        label="Search products"
                        labelHidden
                        autoComplete="off"
                        placeholder="Search by title, SKU, or ID…"
                        value={sourceQuery}
                        onChange={setSourceQuery}
                      />
                    }
                  />
                  {sourceSearchError && (
                    <Banner tone="critical" title="Search failed">
                      <p>{sourceSearchError}</p>
                    </Banner>
                  )}
                  {!sourceSearching && !sourceSearchError && sourceQuery.trim() && sourceOptions.length === 0 && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      No products match &ldquo;{sourceQuery}&rdquo;.
                    </Text>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {sourceProduct && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingSm">2. Select a metafield</Text>

                {definitionsError && (
                  <Banner tone="critical" title="Couldn't load metafield definitions">
                    <p>{definitionsError}</p>
                  </Banner>
                )}

                {!definitionsLoading && definitions.length === 0 && !definitionsError && (
                  <Text as="p" tone="subdued">No product metafield definitions are set up in this store.</Text>
                )}

                {selectedDefinition ? (
                  <Box padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                      <BlockStack gap="050">
                        <Text as="span" fontWeight="semibold">
                          {selectedDefinition.namespace}.{selectedDefinition.key}
                        </Text>
                        <InlineStack gap="150" blockAlign="center">
                          <Badge tone="info">{selectedDefinition.typeName}</Badge>
                          <Text as="span" tone="subdued" variant="bodySm">{selectedDefinition.name}</Text>
                        </InlineStack>
                      </BlockStack>
                      <Button onClick={changeDefinition}>Change metafield</Button>
                    </InlineStack>
                  </Box>
                ) : (
                  definitions.length > 0 && (
                    <Autocomplete
                      options={metafieldAutocompleteOptions}
                      selected={[]}
                      onSelect={(selected) => selected[0] && chooseDefinition(selected[0])}
                      textField={
                        <Autocomplete.TextField
                          label="Search metafields"
                          labelHidden
                          autoComplete="off"
                          placeholder="Search by name, namespace, or key…"
                          value={metafieldQuery}
                          onChange={setMetafieldQuery}
                        />
                      }
                    />
                  )
                )}

                {selectedDefinition && (
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    {valueLoading ? (
                      <InlineStack gap="150" blockAlign="center">
                        <Spinner size="small" accessibilityLabel="Loading value" />
                        <Text as="span" tone="subdued">Loading value…</Text>
                      </InlineStack>
                    ) : valueError ? (
                      <Text as="p" tone="critical">{valueError}</Text>
                    ) : metafieldValue ? (
                      metafieldValue.referencedItems.length > 0 ? (
                        <BlockStack gap="200">
                          <Text as="span" tone="subdued" variant="bodySm">
                            {metafieldValue.referencedItems.length} referenced item
                            {metafieldValue.referencedItems.length === 1 ? "" : "s"}
                          </Text>
                          <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="200">
                            {metafieldValue.referencedItems.map((item) => (
                              <InlineStack key={item.id} gap="150" blockAlign="center" wrap={false}>
                                <Thumbnail source={item.imageUrl ?? FileIcon} alt={item.title} size="small" />
                                <Text as="span" variant="bodySm" truncate>{item.title}</Text>
                              </InlineStack>
                            ))}
                          </InlineGrid>
                        </BlockStack>
                      ) : (
                        <Text as="p" variant="bodyMd">
                          <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{metafieldValue.value}</span>
                        </Text>
                      )
                    ) : (
                      <Text as="p" tone="subdued">
                        &ldquo;{sourceProduct.title}&rdquo; doesn&apos;t have a value set for this metafield — nothing to copy.
                      </Text>
                    )}
                  </Box>
                )}

                {metafieldValue && (
                  <InlineStack gap="200">
                    <Button variant="primary" onClick={() => setPickerOpen(true)}>
                      Copy this data to products
                    </Button>
                    {isProductReference && metafieldValue.referencedItems.length > 0 && (
                      <Button loading={loadingReferencedTargets} onClick={openPickerWithReferencedProducts}>
                        {`Copy to these ${metafieldValue.referencedItems.length} referenced products`}
                      </Button>
                    )}
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {selectedTargets.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingSm">3. Copy to these products</Text>
                  <Button onClick={() => setPickerOpen(true)} disabled={copying}>
                    Edit selection
                  </Button>
                </InlineStack>

                <BlockStack gap="0">
                  {selectedTargets.map((product) => {
                    const status = targetStatus[product.id];
                    return (
                      <Box key={product.id} padding="200" borderBlockEndWidth="025" borderColor="border">
                        <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                          <InlineStack gap="300" blockAlign="center">
                            <Thumbnail source={product.imageUrl ?? ImageIcon} alt={product.title} size="small" />
                            <BlockStack gap="0">
                              <Text as="span" fontWeight="medium">{product.title}</Text>
                              <Text as="span" tone="subdued" variant="bodySm">{product.sku ?? "No SKU"}</Text>
                            </BlockStack>
                          </InlineStack>
                          <InlineStack gap="200" blockAlign="center">
                            {status?.state === "pending" && (
                              <InlineStack gap="100" blockAlign="center">
                                <Spinner size="small" accessibilityLabel="Copying" />
                                <Badge tone="info">Copying…</Badge>
                              </InlineStack>
                            )}
                            {status?.state === "done" && <Badge tone="success">Copied</Badge>}
                            {status?.state === "error" && <Badge tone="critical">{status.message ?? "Error"}</Badge>}
                            {!copying && (
                              <Button
                                icon={XCircleIcon}
                                variant="plain"
                                accessibilityLabel={`Remove ${product.title}`}
                                onClick={() => removeTarget(product.id)}
                              />
                            )}
                          </InlineStack>
                        </InlineStack>
                      </Box>
                    );
                  })}
                </BlockStack>

                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" tone="subdued" variant="bodySm">
                    {copyProgress
                      ? `${doneCount + errorCount}/${copyProgress.total} processed${errorCount > 0 ? ` — ${errorCount} failed` : ""}`
                      : `${selectedTargets.length} product${selectedTargets.length === 1 ? "" : "s"} selected`}
                  </Text>
                  <InlineStack gap="200">
                    {copying && (
                      <Button onClick={cancelCopy} tone="critical">
                        Cancel
                      </Button>
                    )}
                    <Button variant="primary" loading={copying} onClick={copyToProducts}>
                      {copying
                        ? `Copying… (${copyProgress?.done ?? 0}/${copyProgress?.total ?? selectedTargets.length})`
                        : `Copy now to ${selectedTargets.length} product${selectedTargets.length === 1 ? "" : "s"}`}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        initialSelected={selectedTargets}
        onConfirm={handlePickerConfirm}
        excludeId={sourceProduct?.id}
        search={searchProductsForCopierAction}
        searchBySkuList={findProductsBySkuListAction}
      />
    </Page>
  );
}
