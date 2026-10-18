"use client";

import { useMemo, useRef, useState } from "react";
import { Banner, BlockStack, Card, InlineGrid, Text } from "@shopify/polaris";
import type { MetafieldDefinitionSummary } from "@/lib/shopify/metafields";
import type { StoreSkuEntry } from "@/lib/skuMatch";
import { normalizeSku } from "@/lib/skuMatch";
import { parseSkuColumn, splitFoldersByCsv, type CsvFilterMode } from "@/lib/skuCsvFilter";
import type { SkuMediaFolder } from "@/lib/skuMediaZip";
import { MediaUploadForm } from "../media-upload/MediaUploadForm";
import { lookupProductsForMediaAction, type MediaSkuGroup, type MediaSkuProduct } from "../media-upload/actions";
import { getSkuMetafieldOptionsAction } from "../../tools/upload-products/actions";
import { readStoreSkuIndex, type StoreReadProgress } from "../../tools/upload-products/readStoreSkus";
import { CsvFilterPanel, type LoadedCsv } from "./CsvFilterPanel";
import { SkuFieldPanel, SOURCE_METAFIELD, SOURCE_VARIANT } from "./SkuFieldPanel";

type FolderInput = { sku: string; imageCount: number };

/**
 * The second Media uploader: the exact same zip → match → convert → upload
 * flow as the original (it IS the original form, with a few optional hooks),
 * plus two extra choices made up front — which SKU field the folders are
 * matched against (the variant SKU, or any product metafield), and an
 * optional one-column CSV that restricts the upload to — or excludes — a list
 * of SKUs.
 */
export function MediaUploadBySkuForm({ storeName }: { storeName: string }) {
  const [sourceKind, setSourceKind] = useState<string>(SOURCE_VARIANT);
  const [definitions, setDefinitions] = useState<MetafieldDefinitionSummary[] | null>(null);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [metafieldId, setMetafieldId] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);

  const [csv, setCsv] = useState<LoadedCsv | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [mode, setMode] = useState<CsvFilterMode>("include");

  const [folders, setFolders] = useState<SkuMediaFolder[]>([]);
  const [readProgress, setReadProgress] = useState<StoreReadProgress | null>(null);
  const [cachedValueCount, setCachedValueCount] = useState(0);
  // Every SKU value read for a metafield, kept per metafield so scanning again (or after changing the CSV) doesn't re-read the whole store.
  const indexCache = useRef(new Map<string, StoreSkuEntry[]>());

  const selectedDefinition = definitions?.find((d) => d.id === metafieldId) ?? null;
  const metafieldKey = selectedDefinition ? `${selectedDefinition.namespace}.${selectedDefinition.key}` : "";
  const reading = readProgress !== null;

  const changeSourceKind = async (value: string) => {
    setSourceKind(value);
    if (value === SOURCE_METAFIELD && definitions === null) {
      setDefinitionsLoading(true);
      const response = await getSkuMetafieldOptionsAction();
      setDefinitionsLoading(false);
      if (!response.ok) {
        setSetupError(response.error ?? "Couldn't load the store's metafields.");
        setDefinitions([]);
        return;
      }
      setSetupError(null);
      setDefinitions(response.definitions);
      const guess = response.definitions.find((d) => /sku/i.test(d.key) || /sku/i.test(d.name));
      if (guess) {
        setMetafieldId(guess.id);
        setCachedValueCount(indexCache.current.get(`${guess.namespace}.${guess.key}`)?.length ?? 0);
      }
    }
  };

  const changeMetafield = (id: string) => {
    setMetafieldId(id);
    const definition = definitions?.find((d) => d.id === id);
    setCachedValueCount(definition ? (indexCache.current.get(`${definition.namespace}.${definition.key}`)?.length ?? 0) : 0);
  };

  const reloadStoreData = () => {
    indexCache.current.delete(metafieldKey);
    setCachedValueCount(0);
  };

  const handleCsvFile = async (file: File) => {
    try {
      const skus = parseSkuColumn(await file.text());
      if (skus.length === 0) {
        setCsvError("No SKUs found in this file's first column.");
        return;
      }
      setCsv({ name: file.name, skus });
      setCsvError(null);
    } catch {
      setCsvError("Couldn't read this file.");
    }
  };

  const split = useMemo(
    () => (folders.length > 0 && csv ? splitFoldersByCsv(folders.map((f) => f.sku), csv.skus, mode, true) : null),
    [folders, csv, mode],
  );

  /** Product lookup for the form's "Scan and match" step — applies the CSV filter first, then matches by the chosen SKU field. */
  const lookup = async (folderList: FolderInput[]): Promise<{ ok: boolean; groups: MediaSkuGroup[]; error?: string }> => {
    const { eligible } = splitFoldersByCsv(folderList.map((f) => f.sku), csv?.skus ?? null, mode, true);
    const eligibleSet = new Set(eligible);
    const eligibleFolders = folderList.filter((f) => eligibleSet.has(f.sku));
    if (eligibleFolders.length === 0) {
      return { ok: false, groups: [], error: "The CSV filter leaves no SKU folders to scan — check the include / exclude choice and the CSV's SKUs." };
    }

    if (sourceKind === SOURCE_VARIANT) return lookupProductsForMediaAction(eligibleFolders);

    if (!selectedDefinition) return { ok: false, groups: [], error: "Pick the metafield that holds your SKUs first." };

    let entries = indexCache.current.get(metafieldKey);
    if (!entries) {
      setReadProgress({ read: 0, total: null });
      const result = await readStoreSkuIndex(
        { kind: "metafield", namespace: selectedDefinition.namespace, key: selectedDefinition.key },
        setReadProgress,
        () => false,
      );
      setReadProgress(null);
      if (!result.ok) return { ok: false, groups: [], error: result.error };
      entries = result.entries;
      indexCache.current.set(metafieldKey, entries);
      setCachedValueCount(entries.length);
    }

    const byKey = new Map<string, StoreSkuEntry[]>();
    for (const entry of entries) {
      const key = normalizeSku(entry.sku, true);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(entry);
      else byKey.set(key, [entry]);
    }

    const groups: MediaSkuGroup[] = eligibleFolders.map((folder) => {
      const seen = new Set<string>();
      const products: MediaSkuProduct[] = [];
      for (const entry of byKey.get(normalizeSku(folder.sku, true)) ?? []) {
        if (seen.has(entry.productId)) continue;
        seen.add(entry.productId);
        products.push({
          id: entry.productId,
          title: entry.title,
          imageUrl: entry.imageUrl ?? null,
          matchedSku: entry.sku,
          categoryName: null,
          status: entry.status,
        });
      }
      return { sku: folder.sku, imageCount: folder.imageCount, products };
    });
    return { ok: true, groups };
  };

  const resetToken = `${sourceKind}|${metafieldKey}|${csv ? `${csv.name}:${csv.skus.length}` : "none"}|${mode}`;

  const setupSection = (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingSm">How should folders be matched to products?</Text>
          <Text as="p" tone="subdued">
            Choose the SKU field first, and optionally a CSV to limit which SKU folders are uploaded. Then add the zip below — everything after that works like the original Media uploader.
          </Text>
        </BlockStack>
        {setupError && <Banner tone="critical" onDismiss={() => setSetupError(null)}><p>{setupError}</p></Banner>}
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <SkuFieldPanel
            storeName={storeName}
            sourceKind={sourceKind}
            onSourceKindChange={(value) => void changeSourceKind(value)}
            definitions={definitions}
            definitionsLoading={definitionsLoading}
            metafieldId={metafieldId}
            onMetafieldChange={changeMetafield}
            disabled={reading}
            readProgress={readProgress}
            cachedValueCount={cachedValueCount}
            onReload={reloadStoreData}
          />
          <CsvFilterPanel
            csv={csv}
            mode={mode}
            onModeChange={setMode}
            onFile={(file) => void handleCsvFile(file)}
            onClear={() => {
              setCsv(null);
              setCsvError(null);
            }}
            error={csvError}
            split={split}
            folderCount={folders.length}
            disabled={reading}
          />
        </InlineGrid>
      </BlockStack>
    </Card>
  );

  return (
    <MediaUploadForm
      title="Product media uploader (by SKU field)"
      beforeZipSection={setupSection}
      lookup={lookup}
      onFoldersChange={setFolders}
      resetToken={resetToken}
    />
  );
}
