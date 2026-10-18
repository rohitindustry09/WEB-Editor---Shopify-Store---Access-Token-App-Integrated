"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  ChoiceList,
  Icon,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Pagination,
  ProgressBar,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { SearchIcon, StoreIcon, GlobeIcon } from "@shopify/polaris-icons";
import { compareStores } from "@/lib/storeCompare";
import type { SkuTarget } from "@/lib/skuApply";
import type { StoreSkuEntry } from "@/lib/skuMatch";
import type { MetafieldDefinitionSummary } from "@/lib/shopify/metafields";
import type { ScrapedProduct } from "@/lib/storeScraper/types";
import { getSkuMetafieldOptionsAction, loadStoreSkuPageAction, type StoreSkuSource } from "../upload-products/actions";
import { SearchableSelect, type PickerOption } from "../upload-products/SearchableSelect";
import { CompareActions, type CompareTab } from "./CompareActions";
import { CompareColumns, type ColumnRow } from "./CompareColumns";
import { scrapeShopifyStore, normalizeStoreUrl, type ScrapeProgress } from "./scrapeClient";
import { useBulkApplyRunner } from "./useBulkApplyRunner";

const SOURCE_VARIANT = "variant";
const SOURCE_METAFIELD = "metafield";
/** Safety stop for the page-by-page connected-store read (2,000 pages ≈ 500k variants). */
const MAX_STORE_PAGES = 2000;

const PAGE_SIZES: { value: string; label: string }[] = [
  { value: "100", label: "100" },
  { value: "200", label: "200" },
  { value: "500", label: "500" },
  { value: "all", label: "All" },
];

interface LoadedData {
  connected: StoreSkuEntry[];
  scraped: ScrapedProduct[];
  urlHostname: string;
  target: SkuTarget | null;
}

interface ConnectedProgress {
  read: number;
  total: number | null;
}

function Panel({ tag, children }: { tag: ReactNode; children: ReactNode }) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300">
      <BlockStack gap="300">
        <InlineStack>{tag}</InlineStack>
        {children}
      </BlockStack>
    </Box>
  );
}

export function StoreCompareForm({ storeName, shopDomain, currencyCode }: { storeName: string; shopDomain: string; currencyCode: string }) {
  // ---- Setup ----
  const [urlInput, setUrlInput] = useState("");
  const [fresh, setFresh] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [sourceKind, setSourceKind] = useState<string>(SOURCE_VARIANT);
  const [definitions, setDefinitions] = useState<MetafieldDefinitionSummary[] | null>(null);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [metafieldId, setMetafieldId] = useState("");

  // ---- Loading ----
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectedProgress, setConnectedProgress] = useState<ConnectedProgress | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  const [data, setData] = useState<LoadedData | null>(null);
  const cancelRef = useRef(false);

  // ---- View ----
  const [tab, setTab] = useState<CompareTab>("matched");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState("100");
  const [page, setPage] = useState(0);

  const runner = useBulkApplyRunner();

  const selectedDefinition = definitions?.find((d) => d.id === metafieldId) ?? null;
  const source: StoreSkuSource | null =
    sourceKind === SOURCE_VARIANT
      ? { kind: "variant" }
      : selectedDefinition
        ? { kind: "metafield", namespace: selectedDefinition.namespace, key: selectedDefinition.key }
        : null;
  const urlParsed = normalizeStoreUrl(urlInput);
  const canLoad = !loading && source !== null && urlParsed !== null;

  const changeSourceKind = async (value: string) => {
    setSourceKind(value);
    if (value === SOURCE_METAFIELD && definitions === null) {
      setDefinitionsLoading(true);
      const response = await getSkuMetafieldOptionsAction();
      setDefinitionsLoading(false);
      if (!response.ok) {
        setError(response.error ?? "Couldn't load the store's metafields.");
        setDefinitions([]);
        return;
      }
      setDefinitions(response.definitions);
      const guess = response.definitions.find((d) => /sku/i.test(d.key) || /sku/i.test(d.name));
      if (guess) setMetafieldId(guess.id);
    }
  };

  const metafieldOptions: PickerOption[] = [...(definitions ?? [])]
    .sort((a, b) => Number(/sku/i.test(b.key + b.name)) - Number(/sku/i.test(a.key + a.name)))
    .map((d) => ({ value: d.id, label: d.name, helpText: `${d.namespace}.${d.key} · ${d.typeName}` }));

  /** Reads the connected store's SKUs one page at a time so the counts on screen move as each page lands. */
  const readConnectedStore = async (activeSource: StoreSkuSource): Promise<StoreSkuEntry[] | string> => {
    const collected: StoreSkuEntry[] = [];
    let read = 0;
    let total: number | null = null;
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < MAX_STORE_PAGES; pageNumber++) {
      if (cancelRef.current) return "Cancelled.";
      const response = await loadStoreSkuPageAction(activeSource, cursor);
      if (!response.ok) return response.error;
      if (response.total !== null) total = response.total;
      read += response.scanned;
      collected.push(...response.entries);
      setConnectedProgress({ read, total });
      if (!response.nextCursor) return collected;
      cursor = response.nextCursor;
    }
    return "The connected store has more products than this tool can read in one go.";
  };

  const load = async () => {
    if (!source || !urlParsed) return;
    cancelRef.current = false;
    setLoading(true);
    setError(null);
    setData(null);
    setConnectedProgress({ read: 0, total: null });
    setScrapeProgress({ scraped: 0, total: 0, message: "Starting…" });
    setTab("matched");
    setQuery("");
    setPage(0);

    try {
      const [connectedResult, scrapeResult] = await Promise.all([
        readConnectedStore(source),
        scrapeShopifyStore(urlInput, fresh, setScrapeProgress, () => cancelRef.current),
      ]);

      if (typeof connectedResult === "string") {
        cancelRef.current = true;
        setError(`${storeName}: ${connectedResult}`);
        return;
      }
      if (!scrapeResult.ok) {
        setError(`${urlParsed.hostname}: ${scrapeResult.error}`);
        return;
      }

      const target: SkuTarget | null =
        source.kind === "variant"
          ? { kind: "variant" }
          : selectedDefinition && selectedDefinition.typeName === "single_line_text_field"
            ? { kind: "metafield", namespace: source.namespace, key: source.key, type: selectedDefinition.typeName }
            : null;
      setData({ connected: connectedResult, scraped: scrapeResult.products, urlHostname: scrapeResult.hostname, target });
    } finally {
      setLoading(false);
      setConnectedProgress(null);
      setScrapeProgress(null);
    }
  };

  const result = useMemo(() => (data ? compareStores(data.connected, data.scraped, ignoreCase) : null), [data, ignoreCase]);
  const urlName = data?.urlHostname ?? urlParsed?.hostname ?? "Entered store";

  const allRows = useMemo<ColumnRow[]>(() => {
    if (!result) return [];
    if (tab === "matched") {
      return result.matched.map((m) => ({
        sku: m.sku,
        left: { imageUrl: m.connected.imageUrl ?? null, title: m.connected.title },
        right: { imageUrl: m.scraped.images[0] ?? null, title: m.scraped.name },
        flag: m.shared ? "Shared SKU" : undefined,
      }));
    }
    if (tab === "connected") {
      return result.connectedOnly.map((c) => ({
        sku: c.sku,
        left: { imageUrl: c.connected.imageUrl ?? null, title: c.connected.title },
        right: null,
      }));
    }
    return result.urlOnly.map((u) => ({
      sku: u.sku,
      left: null,
      right: { imageUrl: u.scraped.images[0] ?? null, title: u.scraped.name },
    }));
  }, [result, tab]);

  const needle = query.trim().toLowerCase();
  const filteredRows = useMemo(
    () =>
      needle
        ? allRows.filter((r) => r.sku.toLowerCase().includes(needle) || (r.left?.title ?? "").toLowerCase().includes(needle) || (r.right?.title ?? "").toLowerCase().includes(needle))
        : allRows,
    [allRows, needle],
  );

  const perPage = pageSize === "all" ? Math.max(1, filteredRows.length) : Number(pageSize);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / perPage));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * perPage;
  const pageRows = filteredRows.slice(pageStart, pageStart + perPage);

  const tabs: { id: CompareTab; content: string }[] = [
    { id: "matched", content: `Matched Products (${(result?.matched.length ?? 0).toLocaleString()})` },
    { id: "connected", content: `${storeName} (${(result?.connectedOnly.length ?? 0).toLocaleString()})` },
    { id: "url", content: `${urlName} (${(result?.urlOnly.length ?? 0).toLocaleString()})` },
  ];

  const tabHint: Record<CompareTab, string> = {
    matched: `Products whose SKU is in both ${storeName} and ${urlName}.`,
    connected: `Products only in ${storeName} — their SKU isn't in ${urlName}.`,
    url: `Products only in ${urlName} — their SKU isn't in ${storeName}.`,
  };

  const connectedPct = connectedProgress?.total ? Math.min(100, (connectedProgress.read / connectedProgress.total) * 100) : 0;
  const scrapePct = scrapeProgress && scrapeProgress.total > 0 ? Math.min(100, (scrapeProgress.scraped / scrapeProgress.total) * 100) : 0;

  return (
    <Page fullWidth>
      <Layout>
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <InlineStack gap="400" blockAlign="center" wrap={false}>
                <Box background="bg-fill-brand" color="text-inverse" padding="300" borderRadius="300">
                  <Icon source={SearchIcon} tone="inherit" />
                </Box>
                <BlockStack gap="050">
                  <Text as="h1" variant="headingXl">Store compare</Text>
                  <Text as="p" tone="subdued">
                    Read any Shopify store by its address and compare it with your connected store by SKU — nothing changes until you press an action button.
                  </Text>
                </BlockStack>
              </InlineStack>
              <Badge tone="success" icon={StoreIcon} size="large">{storeName || "Connected store"}</Badge>
            </InlineStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <Panel tag={<Badge tone="success" icon={StoreIcon}>{`${storeName || "Connected store"} · connected`}</Badge>}>
                  <ChoiceList
                    title="SKU field to match on"
                    selected={[sourceKind]}
                    onChange={(selected) => void changeSourceKind(selected[0] ?? SOURCE_VARIANT)}
                    choices={[
                      { label: "Variant SKU", value: SOURCE_VARIANT, helpText: "Shopify's standard SKU on each variant." },
                      { label: "A product metafield", value: SOURCE_METAFIELD, helpText: "Use a custom metafield that holds the SKU." },
                    ]}
                  />
                  {sourceKind === SOURCE_METAFIELD && (
                    <SearchableSelect
                      label="Metafield"
                      options={metafieldOptions}
                      value={metafieldId}
                      onChange={setMetafieldId}
                      placeholder="Search the store's metafields"
                      loading={definitionsLoading}
                      disabled={definitionsLoading || loading}
                    />
                  )}
                </Panel>

                <Panel tag={<Badge tone="info" icon={GlobeIcon}>Store to read</Badge>}>
                  <TextField
                    label="Shopify store address"
                    autoComplete="off"
                    value={urlInput}
                    onChange={setUrlInput}
                    placeholder="example-store.com"
                    prefix="https://"
                    disabled={loading}
                    error={urlInput.trim() && !urlParsed ? "That doesn't look like a store address." : undefined}
                    helpText="Its SKU is read from each product's standard SKU. Only public product data is read."
                  />
                  <Checkbox label="Read it fresh (ignore a copy saved earlier)" checked={fresh} onChange={setFresh} disabled={loading} />
                </Panel>
              </InlineGrid>

              <Checkbox label="Ignore upper/lower case and surrounding spaces when matching" checked={ignoreCase} onChange={setIgnoreCase} />

              <InlineStack gap="300" blockAlign="center">
                <Button variant="primary" size="large" icon={SearchIcon} loading={loading} disabled={!canLoad} onClick={() => void load()}>
                  Load & compare
                </Button>
                {loading && (
                  <Button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => {
                      cancelRef.current = true;
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </InlineStack>

              {loading && (
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <BlockStack gap="150">
                    <Text as="p" variant="headingSm">{storeName || "Connected store"}</Text>
                    {connectedProgress?.total ? <ProgressBar progress={connectedPct} size="small" tone="primary" /> : null}
                    <Text as="p" variant="bodySm" tone="subdued">
                      {connectedProgress?.total
                        ? `Read ${connectedProgress.read.toLocaleString()} of ${connectedProgress.total.toLocaleString()}`
                        : `Read ${(connectedProgress?.read ?? 0).toLocaleString()}…`}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="150">
                    <Text as="p" variant="headingSm">{urlParsed?.hostname ?? "Entered store"}</Text>
                    {scrapeProgress && scrapeProgress.total > 0 ? <ProgressBar progress={scrapePct} size="small" tone="primary" /> : null}
                    <Text as="p" variant="bodySm" tone="subdued">
                      {scrapeProgress && scrapeProgress.total > 0
                        ? `${scrapeProgress.message} ${scrapeProgress.scraped.toLocaleString()} of ${scrapeProgress.total.toLocaleString()}`
                        : (scrapeProgress?.message ?? "Starting…")}
                    </Text>
                  </BlockStack>
                </InlineGrid>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>
          </Layout.Section>
        )}

        {data && result && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Tabs
                  tabs={tabs}
                  selected={tabs.findIndex((t) => t.id === tab)}
                  onSelect={(index) => {
                    setTab(tabs[index].id);
                    setPage(0);
                    setQuery("");
                  }}
                />
                <Text as="p" variant="bodySm" tone="subdued">{tabHint[tab]}</Text>

                <CompareActions
                  tab={tab}
                  result={result}
                  storeName={storeName || "your store"}
                  urlStoreName={urlName}
                  shopDomain={shopDomain}
                  currencyCode={currencyCode}
                  target={data.target}
                  runner={runner}
                />

                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <Box minWidth="240px" maxWidth="400px" width="100%">
                    <TextField
                      label="Filter"
                      labelHidden
                      placeholder="Filter by SKU or product name"
                      autoComplete="off"
                      value={query}
                      onChange={(v) => {
                        setQuery(v);
                        setPage(0);
                      }}
                      clearButton
                      onClearButtonClick={() => setQuery("")}
                    />
                  </Box>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">Show</Text>
                    <ButtonGroup variant="segmented">
                      {PAGE_SIZES.map((size) => (
                        <Button
                          key={size.value}
                          pressed={pageSize === size.value}
                          onClick={() => {
                            setPageSize(size.value);
                            setPage(0);
                          }}
                        >
                          {size.label}
                        </Button>
                      ))}
                    </ButtonGroup>
                  </InlineStack>
                </InlineStack>

                <CompareColumns
                  rows={pageRows}
                  startIndex={pageStart}
                  leftName={storeName || "Connected store"}
                  rightName={urlName}
                  leftEmpty={tab === "url" ? `Not in ${storeName || "your store"}` : "Nothing here."}
                  rightEmpty={tab === "connected" ? `Not in ${urlName}` : "Nothing here."}
                />

                {pageCount > 1 && (
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={currentPage > 0}
                      onPrevious={() => setPage(currentPage - 1)}
                      hasNext={currentPage < pageCount - 1}
                      onNext={() => setPage(currentPage + 1)}
                      label={`${(pageStart + 1).toLocaleString()}-${Math.min(pageStart + perPage, filteredRows.length).toLocaleString()} of ${filteredRows.length.toLocaleString()}`}
                    />
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
