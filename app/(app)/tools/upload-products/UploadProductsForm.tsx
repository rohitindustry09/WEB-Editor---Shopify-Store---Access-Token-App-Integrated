"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Page,
  Layout,
  Card,
  Box,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  Banner,
  Badge,
  Checkbox,
  ChoiceList,
  DropZone,
  DataTable,
  Icon,
  Tag,
  Thumbnail,
  ProgressBar,
} from "@shopify/polaris";
import { ImportIcon, FileIcon, SearchIcon, StoreIcon } from "@shopify/polaris-icons";
import { parseCsvRows } from "@/lib/csvParsing";
import type { SkuTarget } from "@/lib/skuApply";
import { matchSkus, normalizeSku, suggestSkuColumn, toCsvSkuRows, type SkuMatchReport, type StoreSkuEntry } from "@/lib/skuMatch";
import type { MetafieldDefinitionSummary } from "@/lib/shopify/metafields";
import { getSkuMetafieldOptionsAction, loadStoreSkuPageAction, type StoreSkuSource } from "./actions";
import { SearchableSelect, type PickerOption } from "./SearchableSelect";
import { SkuMatchResults } from "./SkuMatchResults";
import { resetUploadSettings, saveUploadSettings, useUploadSettings } from "@/lib/uploadSettings";

const SOURCE_VARIANT = "variant";
const SOURCE_METAFIELD = "metafield";
const PREVIEW_ROWS = 5;
/** Safety stop for the page-by-page store read (2,000 pages ≈ 500k variants) so a broken cursor can never loop forever. */
const MAX_STORE_PAGES = 2000;

interface ScanProgress {
  /** Variants (or products, for a metafield source) read from the store so far. */
  storeRead: number;
  storeTotal: number | null;
  /** Unique CSV SKUs already seen in the store while reading. */
  csvFound: number;
  csvTotal: number;
}

function sourceCacheKey(source: StoreSkuSource): string {
  return source.kind === "variant" ? "variant" : `metafield:${source.namespace}.${source.key}`;
}

type StepState = "complete" | "current" | "upcoming";

function StepBadge({ index, label, state }: { index: number; label: string; state: StepState }) {
  return (
    <Badge
      size="large"
      tone={state === "complete" ? "success" : state === "current" ? "info" : undefined}
      progress={state === "complete" ? "complete" : state === "current" ? "partiallyComplete" : "incomplete"}
    >
      {`${index}. ${label}`}
    </Badge>
  );
}

function SectionTitle({ step, title, hint }: { step: number; title: string; hint: string }) {
  return (
    <BlockStack gap="100">
      <InlineStack gap="200" blockAlign="center">
        <Badge tone="info">{`Step ${step}`}</Badge>
        <Text as="h2" variant="headingMd">{title}</Text>
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">{hint}</Text>
    </BlockStack>
  );
}

function FieldPanel({ tag, children }: { tag: ReactNode; children: ReactNode }) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300">
      <BlockStack gap="300">
        <InlineStack>{tag}</InlineStack>
        {children}
      </BlockStack>
    </Box>
  );
}

export function UploadProductsForm({ storeName, shopDomain }: { storeName: string; shopDomain: string }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [skuColumn, setSkuColumn] = useState("");

  // These three are remembered between visits (saved settings), so they are read from there instead of held in state.
  const savedSettings = useUploadSettings();
  const sourceKind: string = savedSettings.sourceKind ?? SOURCE_VARIANT;
  const ignoreCase = savedSettings.ignoreCase ?? true;
  const [definitions, setDefinitions] = useState<MetafieldDefinitionSummary[] | null>(null);
  const [metafieldId, setMetafieldId] = useState("");
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [settingsResetNote, setSettingsResetNote] = useState(false);
  const definitionsRequested = useRef(false);
  const definitionsLoading = sourceKind === SOURCE_METAFIELD && definitions === null;
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SkuMatchReport | null>(null);
  const [scannedAt, setScannedAt] = useState<Date | null>(null);
  const [storeSkuCount, setStoreSkuCount] = useState(0);

  const [progress, setProgress] = useState<ScanProgress | null>(null);
  // Snapshot of where new products would store their SKU, taken when the report is built so later picker changes can't mismatch it.
  const [reportTarget, setReportTarget] = useState<SkuTarget | null>(null);

  const storeCache = useRef(new Map<string, StoreSkuEntry[]>());
  const cancelRef = useRef(false);

  const resetResults = () => {
    setReport(null);
    setError(null);
  };

  const handleDrop = (accepted: File[]) => {
    const picked = accepted[0];
    if (!picked) return;
    setFileName(picked.name);
    setParseError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsvRows(String(reader.result ?? ""));
      if (rows.length < 2) {
        setParseError("This file needs a header row and at least one product row.");
        setHeaders([]);
        setDataRows([]);
        setSkuColumn("");
        resetResults();
        return;
      }
      const [headerRow, ...body] = rows;
      const named = headerRow.map((h, i) => h || `Column ${i + 1}`);
      setHeaders(named);
      setDataRows(body);
      const suggested = suggestSkuColumn(named);
      // The column you used last time wins over the guess, when this CSV has a column with that name.
      const remembered = savedSettings.skuColumnHeader ? named.indexOf(savedSettings.skuColumnHeader) : -1;
      const chosen = remembered >= 0 ? remembered : suggested;
      setSkuColumn(chosen >= 0 ? String(chosen) : "");
      resetResults();
    };
    reader.readAsText(picked);
  };

  const clearFile = () => {
    setFileName(null);
    setParseError(null);
    setHeaders([]);
    setDataRows([]);
    setSkuColumn("");
    resetResults();
  };

  /** Reads the store's metafield definitions once, then re-selects the metafield used last time (or the one that looks like a SKU). */
  const requestDefinitions = async () => {
    if (definitionsRequested.current) return;
    definitionsRequested.current = true;
    const result = await getSkuMetafieldOptionsAction();
    if (!result.ok) {
      setError(result.error ?? "Couldn't load the store's metafields.");
      setDefinitions([]);
      return;
    }
    setDefinitions(result.definitions);
    const remembered = result.definitions.find((d) => `${d.namespace}.${d.key}` === savedSettings.metafieldKey);
    const guess = result.definitions.find((d) => /sku/i.test(d.key) || /sku/i.test(d.name));
    const pick = remembered ?? guess;
    if (pick) setMetafieldId(pick.id);
  };

  // A remembered "metafield" choice needs its definitions loaded as soon as the page opens.
  useEffect(() => {
    if (sourceKind === SOURCE_METAFIELD && definitions === null) void Promise.resolve().then(requestDefinitions);
    // requestDefinitions only reads values that are stable for this check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKind, definitions]);

  const changeSourceKind = (value: string) => {
    saveUploadSettings({ sourceKind: value === SOURCE_METAFIELD ? "metafield" : "variant" });
    resetResults();
  };

  /** Forgets every remembered choice on this page and in the Upload & Update panel, and goes back to the defaults. */
  const resetSavedSettings = () => {
    resetUploadSettings();
    const suggested = suggestSkuColumn(headers);
    setSkuColumn(headers.length > 0 && suggested >= 0 ? String(suggested) : "");
    const guess = definitions?.find((d) => /sku/i.test(d.key) || /sku/i.test(d.name));
    setMetafieldId(guess?.id ?? "");
    setSettingsVersion((version) => version + 1);
    setSettingsResetNote(true);
    resetResults();
  };

  const selectedDefinition = definitions?.find((d) => d.id === metafieldId) ?? null;
  const source: StoreSkuSource | null =
    sourceKind === SOURCE_VARIANT
      ? { kind: "variant" }
      : selectedDefinition
        ? { kind: "metafield", namespace: selectedDefinition.namespace, key: selectedDefinition.key }
        : null;

  const columnIndex = skuColumn === "" ? -1 : Number(skuColumn);
  const sampleValues =
    columnIndex >= 0
      ? dataRows
          .map((r) => r[columnIndex] ?? "")
          .filter(Boolean)
          .slice(0, 4)
      : [];
  const canScan = dataRows.length > 0 && columnIndex >= 0 && source !== null && !scanning;
  const step: 1 | 2 | 3 = report ? 3 : headers.length > 0 ? 2 : 1;
  const stepState = (n: number): StepState => (n < step ? "complete" : n === step ? "current" : "upcoming");

  const runScan = async (forceRefresh: boolean) => {
    if (!source || columnIndex < 0) return;
    setScanning(true);
    setError(null);
    setReport(null);
    cancelRef.current = false;

    const csvRows = toCsvSkuRows(dataRows, columnIndex);
    const csvKeys = new Set<string>();
    for (const row of csvRows) {
      const key = normalizeSku(row.sku, ignoreCase);
      if (key) csvKeys.add(key);
    }
    setProgress({ storeRead: 0, storeTotal: null, csvFound: 0, csvTotal: csvKeys.size });

    try {
      const cacheKey = sourceCacheKey(source);
      let entries = forceRefresh ? undefined : storeCache.current.get(cacheKey);
      if (!entries) {
        const collected: StoreSkuEntry[] = [];
        const found = new Set<string>();
        let storeRead = 0;
        let storeTotal: number | null = null;
        let cursor: string | null = null;
        let finished = false;
        // Read the store one page at a time so the counts on screen move
        // as each page lands, instead of a single long silent wait.
        for (let pageNumber = 0; pageNumber < MAX_STORE_PAGES; pageNumber++) {
          if (cancelRef.current) return;
          const page = await loadStoreSkuPageAction(source, cursor);
          if (!page.ok) {
            setError(page.error);
            return;
          }
          if (page.total !== null) storeTotal = page.total;
          storeRead += page.scanned;
          for (const entry of page.entries) {
            collected.push(entry);
            const key = normalizeSku(entry.sku, ignoreCase);
            if (csvKeys.has(key)) found.add(key);
          }
          setProgress({ storeRead, storeTotal, csvFound: found.size, csvTotal: csvKeys.size });
          if (!page.nextCursor) {
            finished = true;
            break;
          }
          cursor = page.nextCursor;
        }
        if (!finished) {
          setError("The store has more SKUs than this tool can read in one scan.");
          return;
        }
        entries = collected;
        storeCache.current.set(cacheKey, entries);
        setScannedAt(new Date());
      }
      setStoreSkuCount(entries.length);
      setReportTarget(
        source.kind === "variant"
          ? { kind: "variant" }
          : selectedDefinition && selectedDefinition.typeName === "single_line_text_field"
            ? { kind: "metafield", namespace: source.namespace, key: source.key, type: selectedDefinition.typeName }
            : null,
      );
      setReport(matchSkus(csvRows, entries, ignoreCase));
    } finally {
      setScanning(false);
      setProgress(null);
    }
  };

  const columnOptions: PickerOption[] = headers.map((h, i) => {
    const first = dataRows.find((r) => r[i])?.[i];
    return { value: String(i), label: h, helpText: first ? `e.g. ${first}` : undefined };
  });

  // Metafields that look like a SKU go first so the likely choice is right at the top of the list.
  const metafieldOptions: PickerOption[] = [...(definitions ?? [])]
    .sort((a, b) => Number(/sku/i.test(b.key + b.name)) - Number(/sku/i.test(a.key + a.name)))
    .map((d) => ({ value: d.id, label: d.name, helpText: `${d.namespace}.${d.key} · ${d.typeName}` }));

  const previewHeadings = headers.map((h, i) =>
    i === columnIndex ? (
      <InlineStack key={i} gap="150" blockAlign="center" wrap={false}>
        <span>{h}</span>
        <Badge tone="info">SKU</Badge>
      </InlineStack>
    ) : (
      h
    ),
  );

  return (
    <Page fullWidth>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <InlineStack gap="400" blockAlign="center" wrap={false}>
                  <Box background="bg-fill-brand" color="text-inverse" padding="300" borderRadius="300">
                    <Icon source={ImportIcon} tone="inherit" />
                  </Box>
                  <BlockStack gap="050">
                    <Text as="h1" variant="headingXl">Upload Products & Update</Text>
                    <Text as="p" tone="subdued">
                      Match a product CSV to your store by SKU and see what&apos;s new and what already exists.
                    </Text>
                  </BlockStack>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center">
                  <Button variant="tertiary" onClick={resetSavedSettings} accessibilityLabel="Reset all saved settings">Reset saved settings</Button>
                  <Badge tone="success" icon={StoreIcon} size="large">{storeName || "Connected store"}</Badge>
                </InlineStack>
              </InlineStack>
              <InlineStack gap="200">
                <StepBadge index={1} label="Upload CSV" state={stepState(1)} />
                <StepBadge index={2} label="Match SKU fields" state={stepState(2)} />
                <StepBadge index={3} label="Review report" state={stepState(3)} />
              </InlineStack>
              {settingsResetNote && (
                <Banner tone="success" onDismiss={() => setSettingsResetNote(false)}>
                  <p>Saved settings were cleared — everything is back to its defaults. Your choices are saved again as you change them.</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <SectionTitle step={1} title="Choose your CSV file" hint="Any product export or spreadsheet saved as .csv — the first row must be the column names." />
              {fileName ? (
                <>
                  <Box padding="400" background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300">
                    <InlineStack align="space-between" blockAlign="center" gap="300">
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        <Thumbnail source={FileIcon} size="small" alt="" />
                        <BlockStack gap="100">
                          <Text as="span" fontWeight="semibold">{fileName}</Text>
                          {headers.length > 0 && (
                            <InlineStack gap="150">
                              <Badge tone="success">{`${dataRows.length.toLocaleString()} rows`}</Badge>
                              <Badge>{`${headers.length} columns`}</Badge>
                            </InlineStack>
                          )}
                        </BlockStack>
                      </InlineStack>
                      <Button tone="critical" variant="tertiary" onClick={clearFile}>Remove file</Button>
                    </InlineStack>
                  </Box>
                  {headers.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">{`Preview — first ${Math.min(PREVIEW_ROWS, dataRows.length)} rows`}</Text>
                      <DataTable
                        columnContentTypes={headers.map(() => "text" as const)}
                        headings={previewHeadings}
                        rows={dataRows.slice(0, PREVIEW_ROWS).map((row) => headers.map((_, i) => row[i] ?? ""))}
                        truncate
                        hasZebraStripingOnData
                        increasedTableDensity
                      />
                    </BlockStack>
                  )}
                </>
              ) : (
                <DropZone accept=".csv,text/csv" type="file" onDrop={(_files, accepted) => accepted[0] && handleDrop(accepted)}>
                  <DropZone.FileUpload actionTitle="Add CSV file" actionHint="or drop a CSV to upload" />
                </DropZone>
              )}
              {parseError && <Banner tone="critical"><p>{parseError}</p></Banner>}
            </BlockStack>
          </Card>
        </Layout.Section>

        {headers.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <SectionTitle step={2} title="Choose the SKU fields to match on" hint="Pick the CSV column and the store field that hold the same SKU." />
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <FieldPanel tag={<Badge tone="info" icon={FileIcon}>CSV file</Badge>}>
                    <SearchableSelect
                      label="SKU column"
                      options={columnOptions}
                      value={skuColumn}
                      onChange={(v) => {
                        setSkuColumn(v);
                        saveUploadSettings({ skuColumnHeader: v === "" ? "" : (headers[Number(v)] ?? "") });
                        resetResults();
                      }}
                      placeholder="Search your CSV columns"
                    />
                    {sampleValues.length > 0 && (
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Sample values</Text>
                        <InlineStack gap="150">
                          {sampleValues.map((v, i) => <Tag key={i}>{v}</Tag>)}
                        </InlineStack>
                      </BlockStack>
                    )}
                  </FieldPanel>

                  <FieldPanel tag={<Badge tone="success" icon={StoreIcon}>{storeName ? `${storeName} · connected store` : "Connected store"}</Badge>}>
                    <ChoiceList
                      title="Store SKU field"
                      selected={[sourceKind]}
                      onChange={(selected) => changeSourceKind(selected[0] ?? SOURCE_VARIANT)}
                      choices={[
                        { label: "Variant SKU", value: SOURCE_VARIANT, helpText: "Shopify's standard SKU — the SKU box on each variant." },
                        { label: "A product metafield", value: SOURCE_METAFIELD, helpText: "Use a custom metafield that holds the SKU." },
                      ]}
                    />
                    {sourceKind === SOURCE_METAFIELD && (
                      <SearchableSelect
                        label="Metafield"
                        options={metafieldOptions}
                        value={metafieldId}
                        onChange={(v) => {
                          setMetafieldId(v);
                          const chosen = definitions?.find((d) => d.id === v);
                          saveUploadSettings({ metafieldKey: chosen ? `${chosen.namespace}.${chosen.key}` : "" });
                          resetResults();
                        }}
                        placeholder="Search the store's metafields"
                        loading={definitionsLoading}
                        disabled={definitionsLoading}
                        helpText={
                          definitions && definitions.length === 0
                            ? "This store has no product metafield definitions."
                            : "Products whose metafield is empty are ignored."
                        }
                      />
                    )}
                  </FieldPanel>
                </InlineGrid>

                <Checkbox
                  label="Ignore upper/lower case and surrounding spaces when matching"
                  checked={ignoreCase}
                  onChange={(v) => {
                    saveUploadSettings({ ignoreCase: v });
                    resetResults();
                  }}
                />

                <InlineStack gap="300" blockAlign="center">
                  <Button variant="primary" size="large" icon={SearchIcon} onClick={() => void runScan(false)} loading={scanning} disabled={!canScan}>
                    Scan store & compare
                  </Button>
                  {scannedAt && report && (
                    <>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {`Read ${storeSkuCount.toLocaleString()} store SKUs at ${scannedAt.toLocaleTimeString()}`}
                      </Text>
                      <Button variant="plain" onClick={() => void runScan(true)} disabled={scanning}>Refresh store data</Button>
                    </>
                  )}
                </InlineStack>
                {scanning && progress && (
                  <Box padding="400" background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" gap="300">
                        <BlockStack gap="050">
                          <Text as="p" variant="headingMd">
                            {`Counted ${progress.csvFound.toLocaleString()} of ${progress.csvTotal.toLocaleString()} CSV SKUs`}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">found in the store so far</Text>
                        </BlockStack>
                        <Button
                          variant="tertiary"
                          tone="critical"
                          onClick={() => {
                            cancelRef.current = true;
                          }}
                        >
                          Cancel
                        </Button>
                      </InlineStack>
                      {progress.storeTotal ? (
                        <ProgressBar progress={Math.min(100, (progress.storeRead / progress.storeTotal) * 100)} tone="primary" size="small" />
                      ) : null}
                      <Text as="p" variant="bodySm" tone="subdued">
                        {progress.storeTotal
                          ? `Read ${progress.storeRead.toLocaleString()} of ${progress.storeTotal.toLocaleString()} ${sourceKind === SOURCE_METAFIELD ? "products" : "variants"} in ${storeName || "your store"}`
                          : `Read ${progress.storeRead.toLocaleString()} ${sourceKind === SOURCE_METAFIELD ? "products" : "variants"} from ${storeName || "your store"}…`}
                      </Text>
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>
          </Layout.Section>
        )}

        {report && (
          <Layout.Section>
            <SkuMatchResults report={report} headers={headers} shopDomain={shopDomain} storeName={storeName} target={reportTarget} settingsVersion={settingsVersion} onResetSettings={resetSavedSettings} />
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
