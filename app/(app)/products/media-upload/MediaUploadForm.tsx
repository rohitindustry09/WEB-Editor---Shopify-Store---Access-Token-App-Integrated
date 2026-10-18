"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  DropZone,
  Icon,
  Badge,
  Box,
  Checkbox,
  ChoiceList,
  Popover,
  ProgressBar,
} from "@shopify/polaris";
import { WorkersField } from "@/components/WorkersField";
import { StatTile } from "@/components/ui/StatTile";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { FileIcon, XCircleIcon } from "@shopify/polaris-icons";
import { formatFileSize } from "@/lib/csvSkuColors";
import { loadSkuMediaZip, readFolderImages, type SkuMediaFolder, type StreamingZipHandle } from "@/lib/skuMediaZip";
import { uploadToStagedTarget } from "@/lib/stagedUpload";
import { mediaApi } from "@/lib/mediaUploadApi";
import { mapWithConcurrency } from "@/lib/concurrency";
import { clearUploadedIds, loadUploadedIds, productIdMatches, recordUploaded, zipProgressKey } from "@/lib/mediaUploadProgress";
import { processImage, type ConversionSettings, type ProcessedImage } from "@/lib/imageProcessing";
import type { ImageProcessStep } from "@/components/products/MediaImageGrid";
import type { MediaOrderItem } from "@/components/products/MediaReorderRow";
import { MediaProductRow, type RowStatus } from "@/components/products/MediaProductRow";
import {
  MediaConversionSettings,
  DEFAULT_CONVERSION_STATE,
  type ConversionUiState,
} from "@/components/products/MediaConversionSettings";
import { getLastUploadedMediaIds, setLastUploadedMediaIds } from "@/lib/mediaUploadHistory";
import type { ExistingMediaItem } from "@/lib/shopify/media";
import {
  lookupProductsForMediaAction,
  getExistingMediaBatchAction,
  type MediaSkuGroup,
  type MediaSkuProduct,
  type ProductStatus,
} from "./actions";

type PreviewSummary = { originalTotal: number; estimatedTotal: number; count: number };

/**
 * Every prop is optional — with none of them this is the original Media
 * uploader, unchanged. The "by SKU field" variant of the tool supplies them
 * to swap the product lookup (a metafield instead of the variant SKU),
 * narrow which SKU folders are scanned (CSV include / exclude), and add its
 * own pickers above the zip card.
 */
export interface MediaUploadFormProps {
  title?: string;
  /** Rendered as its own section above the zip card. */
  beforeZipSection?: ReactNode;
  /** Replaces the default per-SKU product search; must return groups in the same shape. */
  lookup?: (folders: { sku: string; imageCount: number }[]) => Promise<{ ok: boolean; groups: MediaSkuGroup[]; error?: string }>;
  /** Called with the parsed SKU folders when a zip finishes loading, and with [] when it's removed or fails. */
  onFoldersChange?: (folders: SkuMediaFolder[]) => void;
  /** Changing this clears the scan results (e.g. because the SKU field or CSV filter changed), without unloading the zip. */
  resetToken?: string | number;
}

const PAGE_SIZE = 50;
const SETTINGS_STORAGE_KEY = "media-upload:conversion-settings";
const LARGE_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_WORKERS = 50;
/** Within ONE product: images converted / sent to Shopify's storage at the same time (each worker handles one product). */
const IMAGE_CONVERT_CONCURRENCY = 4;
const IMAGE_UPLOAD_CONCURRENCY = 4;
const DEFAULT_UPLOAD_WORKERS = 3;

// Stable "nothing here" fallbacks — using `?? []` / `?? {}` inline would
// create a brand-new array/object every render, which defeats memoization
// on rows that don't actually have any data for a given key.
const EMPTY_PREVIEWS: { url: string; filename: string }[] = [];
const EMPTY_STATUS: Record<string, ImageProcessStep> = {};
const EMPTY_LAST_UPLOAD_IDS: string[] = [];
const EMPTY_FILENAMES: string[] = [];

const STATUS_FILTER_OPTIONS: { label: string; value: ProductStatus }[] = [
  { label: "Active", value: "ACTIVE" },
  { label: "Draft", value: "DRAFT" },
  { label: "Archived", value: "ARCHIVED" },
];
const ALL_STATUSES: ProductStatus[] = STATUS_FILTER_OPTIONS.map((o) => o.value);


type GroupTab = "all" | "found" | "notFound" | "shared";


function toConversionSettings(ui: ConversionUiState): ConversionSettings {
  const maxSizeBytes =
    ui.maxSizeOption === "none" ? null : ui.maxSizeOption === "custom" ? ui.customMaxSizeKb * 1024 : Number(ui.maxSizeOption) * 1024;
  return {
    format: ui.format,
    quality: ui.quality / 100,
    maxSizeBytes,
    resizeOverMegapixels: ui.resizeOverMegapixels,
    customResize: ui.customResizeEnabled ? { width: ui.customWidth, height: ui.customHeight } : null,
  };
}

function loadStoredConversionSettings(): ConversionUiState {
  if (typeof window === "undefined") return DEFAULT_CONVERSION_STATE;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CONVERSION_STATE;
    return { ...DEFAULT_CONVERSION_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONVERSION_STATE;
  }
}

export function MediaUploadForm({ title = "Product media uploader", beforeZipSection, lookup, onFoldersChange, resetToken }: MediaUploadFormProps = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [zip, setZip] = useState<StreamingZipHandle | null>(null);
  const [folders, setFolders] = useState<SkuMediaFolder[]>([]);

  const [groups, setGroups] = useState<MediaSkuGroup[]>([]);
  // Which product statuses stay eligible to upload to — all three checked by
  // default so nothing is filtered out unless the user narrows it down.
  const [statusFilter, setStatusFilter] = useState<ProductStatus[]>(ALL_STATUSES);
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  // Which stat tile is "pressed" — narrows the SKU list below to just that
  // subset (found / not found / shared) without re-scanning anything.
  const [groupTab, setGroupTab] = useState<GroupTab>("all");
  const selectGroupTab = (tab: GroupTab) => {
    setGroupTab(tab);
    setPage(0);
  };
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, startLookup] = useTransition();
  const [looked, setLooked] = useState(false);
  const [page, setPage] = useState(0);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [uploading, setUploading] = useState(false);
  // How many products upload at the same time.
  const [workers, setWorkers] = useState(DEFAULT_UPLOAD_WORKERS);
  const [cancelling, setCancelling] = useState(false);
  // How many products were found already uploaded from this zip (remembered across a reload) — shown as a note next to Resume.
  const [resumeNotice, setResumeNotice] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  // One AbortController per product currently uploading — lets "Restart"
  // actually cut off a hung in-flight request instead of just hoping a
  // second attempt somehow gets further.
  const productAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Loaded once, client-side only — the default state renders first so
  // server and client markup match, then this swaps in whatever was saved
  // last time, same as any "restore from localStorage" pattern.
  const [conversion, setConversion] = useState<ConversionUiState>(DEFAULT_CONVERSION_STATE);
  useEffect(() => {
    setConversion(loadStoredConversionSettings());
  }, []);

  const [previewing, setPreviewing] = useState(false);
  const [previewSummary, setPreviewSummary] = useState<PreviewSummary | null>(null);

  // Nested by SKU, then filename — so updating one SKU's image status
  // leaves every other SKU's status sub-object at the same reference,
  // which is what lets the per-row memoization below actually skip work.
  const [imageStatus, setImageStatus] = useState<Record<string, Record<string, ImageProcessStep>>>({});
  const setImageStep = (sku: string, filename: string, step: ImageProcessStep) => {
    setImageStatus((prev) => ({ ...prev, [sku]: { ...(prev[sku] ?? {}), [filename]: step } }));
  };
  const processedCacheRef = useRef<Map<string, ProcessedImage>>(new Map());

  // Cached alongside existingMedia — avoids a localStorage read + JSON.parse
  // on every render just to compute a badge.
  const [lastUploadCache, setLastUploadCache] = useState<Record<string, string[]>>({});

  // Per-product drag order, mixing existing product images with the new
  // ones queued for it. Absent until the user actually drags something —
  // until then the default order (existing, then new) is computed on read.
  const [mediaOrder, setMediaOrder] = useState<Record<string, MediaOrderItem[]>>({});

  // Off by default — fetching every matched product's existing images (one
  // GraphQL round trip each) used to happen automatically for the whole
  // list, which is what made a large zip feel like it hung. Now it's fetched
  // lazily, in batches, only for whichever page is on screen, and only when
  // this is turned on.
  const [showMediaPreviews, setShowMediaPreviews] = useState(false);
  const [existingMedia, setExistingMedia] = useState<Record<string, ExistingMediaItem[]>>({});
  const existingMediaRef = useRef(existingMedia);
  useEffect(() => {
    existingMediaRef.current = existingMedia;
  }, [existingMedia]);

  /** `viaApi` is for the upload itself: its server calls must run in parallel across workers, which server actions can't do. */
  const ensureExistingMedia = async (productIds: string[], viaApi = false) => {
    setLastUploadCache((prev) => {
      const next: Record<string, string[]> = { ...prev };
      let changed = false;
      for (const id of productIds) {
        if (!(id in next)) {
          next[id] = getLastUploadedMediaIds(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const missing = productIds.filter((id) => !(id in existingMediaRef.current));
    if (missing.length === 0) return;
    const fetched = viaApi ? await mediaApi.getExistingMediaBatch(missing) : await getExistingMediaBatchAction(missing);
    existingMediaRef.current = { ...existingMediaRef.current, ...fetched };
    setExistingMedia((prev) => ({ ...prev, ...fetched }));
  };

  const [previews, setPreviews] = useState<Record<string, { url: string; filename: string }[]>>({});
  const latestPreviewsRef = useRef(previews);
  useEffect(() => {
    latestPreviewsRef.current = previews;
  }, [previews]);

  const revokePreviews = (map: Record<string, { url: string; filename: string }[]>) => {
    Object.values(map).forEach((images) => images.forEach((img) => URL.revokeObjectURL(img.url)));
  };

  // Revoke every object URL still around when the component unmounts.
  useEffect(() => {
    return () => revokePreviews(latestPreviewsRef.current);
  }, []);

  // Any change to the conversion settings invalidates whatever was already
  // processed/previewed — nothing here is safe to reuse anymore — and is
  // persisted so the next visit starts from the same settings.
  const handleConversionChange = (next: ConversionUiState) => {
    setConversion(next);
    processedCacheRef.current.clear();
    setImageStatus({});
    setPreviewSummary(null);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage full or disabled — settings just won't persist
      }
    }
  };

  const resetResults = () => {
    setGroups([]);
    setLooked(false);
    setLookupError(null);
    setPage(0);
    setGroupTab("all");
    setRowStatus({});
    setUploadProgress(null);
    setUploadError(null);
    setImageStatus({});
    setPreviewSummary(null);
    setMediaOrder({});
    setExistingMedia({});
    existingMediaRef.current = {};
    setLastUploadCache({});
    processedCacheRef.current.clear();
    for (const controller of productAbortControllersRef.current.values()) controller.abort();
    productAbortControllersRef.current.clear();
  };

  const handleFile = async (picked: File) => {
    revokePreviews(previews);
    setPreviews({});
    setFile(picked);
    setParseError(null);
    resetResults();
    setParsing(true);
    try {
      const loaded = await loadSkuMediaZip(picked);
      setZip(loaded.zip);
      setFolders(loaded.folders);
      onFoldersChange?.(loaded.folders);
      if (loaded.folders.length === 0) {
        setParseError('No "<SKU>/<image>" folders were found in this zip.');
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't read this zip file.");
      setZip(null);
      setFolders([]);
      onFoldersChange?.([]);
    } finally {
      setParsing(false);
    }
  };

  const clearFile = () => {
    revokePreviews(previews);
    setPreviews({});
    setFile(null);
    setZip(null);
    setFolders([]);
    onFoldersChange?.([]);
    setParseError(null);
    resetResults();
  };

  // A changed `resetToken` means the host's setup (SKU field, CSV filter) no
  // longer matches the scan on screen — drop those results, keep the zip.
  const seenResetToken = useRef(resetToken);
  useEffect(() => {
    if (seenResetToken.current === resetToken) return;
    seenResetToken.current = resetToken;
    resetResults();
  }, [resetToken]);

  const runLookup = () => {
    setLookupError(null);
    startLookup(async () => {
      const result = await (lookup ?? lookupProductsForMediaAction)(
        folders.map((f) => ({ sku: f.sku, imageCount: f.imageCount })),
      );
      if (!result.ok) {
        setLookupError(result.error ?? "Couldn't look up products.");
        return;
      }
      setGroups(result.groups);
      setLooked(true);
      setPage(0);
      // Products this same zip already finished (remembered from an earlier run) come back marked as uploaded, which is what makes Resume appear.
      const restored: Record<string, RowStatus> = {};
      if (file) {
        const done = loadUploadedIds(zipProgressKey(file));
        for (const group of result.groups) {
          for (const product of group.products) {
            if (productIdMatches(product.id, done)) restored[product.id] = { state: "uploaded" };
          }
        }
      }
      setRowStatus(restored);
      setResumeNotice(Object.keys(restored).length > 0 ? Object.keys(restored).length : null);
      setMediaOrder({});
    });
  };

  // Applies the status filter without losing track of a SKU that matched a
  // product but got filtered out here — that's a different empty state
  // ("excluded by status filter") than a SKU nothing in the store matched.
  const visibleGroups = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        products: g.products.filter((p) => statusFilter.includes(p.status)),
        matchedBeforeFilter: g.products.length,
      })),
    [groups, statusFilter],
  );

  const allProducts = visibleGroups.flatMap((g) => g.products);
  // After a Cancel (or a few failures) the finished products stay marked as uploaded, so Resume can pick up exactly where the run left off.
  const uploadedCount = allProducts.filter((p) => rowStatus[p.id]?.state === "uploaded").length;
  const remainingCount = allProducts.length - uploadedCount;
  // Live totals for the strip under the tiles — recomputed from each row's status, so they move as every product finishes.
  const processingCount = allProducts.filter((p) => rowStatus[p.id]?.state === "processing").length;
  const failedCount = allProducts.filter((p) => rowStatus[p.id]?.state === "error").length;
  const skuGroupsWithProducts = visibleGroups.filter((g) => g.products.length > 0);
  const skusDoneCount = skuGroupsWithProducts.filter((g) => g.products.every((p) => rowStatus[p.id]?.state === "uploaded")).length;
  const showLiveProgress = uploading || uploadedCount > 0 || failedCount > 0;
  const finishedCount = uploadedCount + failedCount;
  const livePercent = allProducts.length > 0 ? (finishedCount / allProducts.length) * 100 : 0;
  const foundGroups = visibleGroups.filter((g) => g.products.length > 0);
  const notFoundGroups = visibleGroups.filter((g) => g.products.length === 0 && g.matchedBeforeFilter === 0);
  const excludedByStatusGroups = visibleGroups.filter((g) => g.products.length === 0 && g.matchedBeforeFilter > 0);
  const sharedSkuGroups = visibleGroups.filter((g) => g.products.length > 1);
  const totalImages = visibleGroups.reduce((sum, g) => sum + g.imageCount, 0);

  // The stat tile pressed above narrows which groups are eligible for
  // pagination/display — "Images total" has no natural subset of its own,
  // so it (like "SKU folders scanned") just clears back to "all".
  const tabGroups = useMemo(() => {
    switch (groupTab) {
      case "found":
        return foundGroups;
      case "notFound":
        return notFoundGroups;
      case "shared":
        return sharedSkuGroups;
      default:
        return visibleGroups;
    }
  }, [groupTab, visibleGroups, foundGroups, notFoundGroups, sharedSkuGroups]);

  const pageCount = Math.max(1, Math.ceil(tabGroups.length / PAGE_SIZE));
  const pageGroups = useMemo(
    () => tabGroups.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [tabGroups, page],
  );

  // Lazily decodes and object-URLs each visible SKU folder's images so the
  // reorder row below has something to render — only for the current page,
  // only once per SKU (skipped once it's already in `previews`), and only
  // when previews are actually turned on (this is the expensive step).
  useEffect(() => {
    if (!zip || !showMediaPreviews) return;
    let cancelled = false;
    (async () => {
      for (const group of pageGroups) {
        if (group.products.length === 0 || group.sku in latestPreviewsRef.current) continue;
        const folder = folders.find((f) => f.sku === group.sku);
        if (!folder) continue;
        const images = await readFolderImages(zip, folder.filePaths);
        if (cancelled) return;
        const loaded = images.map((img) => ({ url: URL.createObjectURL(img.blob), filename: img.filename }));
        setPreviews((prev) => ({ ...prev, [group.sku]: loaded }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zip, showMediaPreviews, pageGroups, folders]);

  // Same idea for each visible product's existing Shopify images — fetched
  // in one batched call per page instead of one-by-one.
  useEffect(() => {
    if (!showMediaPreviews) return;
    const ids = pageGroups.flatMap((g) => g.products.map((p) => p.id));
    if (ids.length === 0) return;
    ensureExistingMedia(ids);
  }, [showMediaPreviews, pageGroups]);

  // The authoritative list of "new" filenames for every SKU, sourced from
  // the zip's own central directory (`folders`) rather than from `previews`
  // — `previews` only holds data for whichever SKUs were ever displayed
  // with the preview toggle on, so using it as the source of truth for what
  // needs uploading silently dropped everything else (both from the actual
  // upload plan, and from this row's own "N images" count, which is why it
  // could get stuck showing "Uploading 0/0"). Stable across re-renders,
  // since `folders` is only set once when the zip is parsed.
  const newFilenamesBySku = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const folder of folders) {
      map[folder.sku] = folder.filePaths.map((p) => p.split("/").pop() ?? p);
    }
    return map;
  }, [folders]);

  const getDefaultOrder = (group: MediaSkuGroup, product: MediaSkuProduct): MediaOrderItem[] => {
    const existingItems: MediaOrderItem[] = (existingMedia[product.id] ?? []).map((m) => ({
      kind: "existing",
      mediaId: m.id,
      url: m.url,
    }));

    const previewImages = previews[group.sku];
    const filenames = newFilenamesBySku[group.sku] ?? EMPTY_FILENAMES;

    const newItems: MediaOrderItem[] = filenames.map((filename) => ({
      kind: "new",
      key: `${group.sku}::${filename}`,
      sku: group.sku,
      filename,
      url: previewImages?.find((img) => img.filename === filename)?.url ?? "",
    }));
    return [...existingItems, ...newItems];
  };

  const getMediaOrder = (group: MediaSkuGroup, product: MediaSkuProduct): MediaOrderItem[] =>
    mediaOrder[product.id] ?? getDefaultOrder(group, product);

  // Stable identity (empty deps) so passing this to a memoized row doesn't
  // force it to re-render just because the parent re-rendered.
  const handleReorder = useCallback((productId: string, next: MediaOrderItem[]) => {
    setMediaOrder((prev) => ({ ...prev, [productId]: next }));
  }, []);

  const runPreviewConversion = async () => {
    if (!zip) return;
    setPreviewing(true);
    setPreviewSummary(null);
    const settings = toConversionSettings(conversion);
    let originalTotal = 0;
    let estimatedTotal = 0;
    let count = 0;
    try {
      for (const group of foundGroups) {
        const folder = folders.find((f) => f.sku === group.sku);
        if (!folder) continue;
        const images = await readFolderImages(zip, folder.filePaths);
        for (const img of images) {
          const key = `${group.sku}::${img.filename}`;
          setImageStep(group.sku, img.filename, "checking");
          try {
            setImageStep(group.sku, img.filename, "converting");
            const processed = await processImage(img, settings);
            processedCacheRef.current.set(key, processed);
            originalTotal += processed.originalSize;
            estimatedTotal += processed.blob.size;
            count++;
            setImageStep(group.sku, img.filename, "done");
          } catch {
            setImageStep(group.sku, img.filename, "error");
          }
        }
      }
      setPreviewSummary({ originalTotal, estimatedTotal, count });
    } finally {
      setPreviewing(false);
    }
  };

  /** Processes (or reuses the cached conversion of) a single new-image entry, reading its bytes from the zip on demand. */
  const processSingleImage = async (sku: string, filename: string, settings: ConversionSettings): Promise<ProcessedImage> => {
    const key = `${sku}::${filename}`;
    const cached = processedCacheRef.current.get(key);
    if (cached) return cached;
    const folder = folders.find((f) => f.sku === sku);
    const path = folder?.filePaths.find((p) => p.endsWith(`/${filename}`)) ?? `${sku}/${filename}`;
    const [raw] = await readFolderImages(zip!, [path]);
    if (!raw) throw new Error(`Couldn't find "${filename}" in the zip anymore.`);
    const processed = await processImage(raw, settings);
    processedCacheRef.current.set(key, processed);
    return processed;
  };

  /** Uploads one product's queued images in whatever order the user dragged them into, merged with its existing images — shared by the bulk run and the per-row retry button. */
  const uploadForProduct = async (
    group: MediaSkuGroup,
    product: MediaSkuProduct,
    orderedItems: MediaOrderItem[],
    settings: ConversionSettings,
  ) => {
    /** Stops this product at the next safe point once Cancel was pressed — handled by the catch below, which puts the row back to idle. */
    const throwIfCancelled = () => {
      if (cancelledRef.current) throw new Error("__cancelled__");
    };
    throwIfCancelled();
    setRowStatus((prev) => ({ ...prev, [product.id]: { state: "processing" } }));
    const abortController = new AbortController();
    productAbortControllersRef.current.set(product.id, abortController);
    try {
      // The product's current images are only needed to replace/delete them; a plain add doesn't need that round trip.
      if (conversion.replaceMode !== "none") await ensureExistingMedia([product.id], true);
      throwIfCancelled();
      const currentExisting = existingMediaRef.current[product.id] ?? [];
      let items = orderedItems;

      if (conversion.replaceMode === "all" && currentExisting.length > 0) {
        throwIfCancelled();
        const cleared = await mediaApi.clearProductMedia(product.id);
        if (!cleared.ok) throw new Error(cleared.error ?? "Couldn't clear the existing images.");
        items = items.filter((i) => i.kind === "new");
      } else if (conversion.replaceMode === "lastUpload") {
        const lastIds = getLastUploadedMediaIds(product.id).filter((id) =>
          currentExisting.some((m) => m.id === id),
        );
        if (lastIds.length > 0) {
          const cleared = await mediaApi.deleteProductMediaIds(product.id, lastIds);
          if (!cleared.ok) throw new Error(cleared.error ?? "Couldn't delete your previous upload.");
          items = items.filter((i) => i.kind !== "existing" || !lastIds.includes(i.mediaId));
        }
      }

      const newItems = items.filter((i): i is Extract<MediaOrderItem, { kind: "new" }> => i.kind === "new");

      if (newItems.length === 0) {
        setRowStatus((prev) => ({ ...prev, [product.id]: { state: "uploaded" } }));
        if (file) recordUploaded(zipProgressKey(file), product.id);
        return;
      }

      // Several images at once (results keep their order) instead of one after another.
      const processedImages: ProcessedImage[] = await mapWithConcurrency(newItems, IMAGE_CONVERT_CONCURRENCY, async (item) => {
        throwIfCancelled();
        return processSingleImage(item.sku, item.filename, settings);
      });

      throwIfCancelled();
      const staged = await mediaApi.createStagedUploads(
        processedImages.map((img) => ({ filename: img.filename, mimeType: img.mimeType, fileSize: String(img.blob.size) })),
      );
      if (!staged.ok) throw new Error(staged.error ?? "Couldn't prepare the upload.");

      await mapWithConcurrency(
        staged.targets.map((_, index) => index),
        IMAGE_UPLOAD_CONCURRENCY,
        async (i) => {
        if (cancelledRef.current) throw new Error("__cancelled__");
        // Status is keyed by the *original* filename (what the row's counter
        // and thumbnail overlays look up by) — `processedImages[i].filename`
        // may have a different extension once format conversion renamed it.
        setImageStep(group.sku, newItems[i].filename, "uploading");
        await uploadToStagedTarget(staged.targets[i], processedImages[i], abortController.signal);
        setImageStep(group.sku, newItems[i].filename, "done");
        },
      );

      throwIfCancelled();
      const attach = await mediaApi.attachProductMedia(
        product.id,
        staged.targets.map((t, i) => ({ resourceUrl: t.resourceUrl, alt: `${product.title} ${i + 1}` })),
      );
      if (!attach.ok) throw new Error(attach.error ?? "Couldn't attach the images.");
      setLastUploadedMediaIds(product.id, attach.mediaIds);
      setLastUploadCache((prev) => ({ ...prev, [product.id]: attach.mediaIds }));

      let newIndex = 0;
      const finalOrder = items.map((item) => (item.kind === "existing" ? item.mediaId : attach.mediaIds[newIndex++]));
      throwIfCancelled();
      // With no existing images in the mix, attaching already left them in the right order — one less Shopify call per product.
      if (items.some((item) => item.kind === "existing")) {
        await mediaApi.reorderProductMedia(product.id, finalOrder.filter(Boolean) as string[]);
      }
      // Remembered in this browser, so the run can be resumed even after a reload or a server restart.
      if (file) recordUploaded(zipProgressKey(file), product.id);

      setRowStatus((prev) => ({ ...prev, [product.id]: { state: "uploaded" } }));
    } catch (err) {
      if (err instanceof Error && err.message === "__cancelled__") {
        setRowStatus((prev) => ({ ...prev, [product.id]: { state: "idle" } }));
        return;
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        if (cancelledRef.current) {
          setRowStatus((prev) => ({ ...prev, [product.id]: { state: "idle" } }));
          return;
        }
        // Restart already kicked off a fresh attempt for this product —
        // don't overwrite whatever status that attempt is now showing.
        return;
      }
      setRowStatus((prev) => ({
        ...prev,
        [product.id]: { state: "error", message: err instanceof Error ? err.message : "Upload failed." },
      }));
    } finally {
      if (productAbortControllersRef.current.get(product.id) === abortController) {
        productAbortControllersRef.current.delete(product.id);
      }
    }
  };

  /** `onlyRemaining` is the Resume button: products that already finished uploading are skipped, everything else carries on. */
  const uploadAll = async (onlyRemaining = false) => {
    setUploadError(null);

    if (!zip) {
      setUploadError(
        'The zip isn\'t loaded anymore — re-select it above and click "Scan and match products" again before uploading.',
      );
      return;
    }

    cancelledRef.current = false;
    setCancelling(false);
    setUploading(true);
    try {
      // Figure out up front which products will actually run, so the button
      // can show real progress instead of just a spinner.
      const toProcess: { group: MediaSkuGroup; product: MediaSkuProduct }[] = [];
      for (const group of visibleGroups) {
        if (group.products.length === 0) continue;
        for (const product of group.products) {
          const orderedItems = getMediaOrder(group, product);
          if (orderedItems.filter((i) => i.kind === "new").length === 0 && conversion.replaceMode === "none") continue;
          if (onlyRemaining && rowStatus[product.id]?.state === "uploaded") continue;
          toProcess.push({ group, product });
        }
      }
      setUploadProgress({ done: 0, total: toProcess.length });

      const settings = toConversionSettings(conversion);

      // A product shared by several SKU folders must never be handled by two workers at once (they would fight over its order and status),
      // so each product is one unit of work and its folders run one after another inside it.
      const unitsByProduct = new Map<string, { group: MediaSkuGroup; product: MediaSkuProduct }[]>();
      for (const entry of toProcess) {
        const unit = unitsByProduct.get(entry.product.id);
        if (unit) unit.push(entry);
        else unitsByProduct.set(entry.product.id, [entry]);
      }
      const units = [...unitsByProduct.values()];

      let cursor = 0;
      const worker = async () => {
        while (!cancelledRef.current) {
          const index = cursor++;
          if (index >= units.length) return;
          for (const { group, product } of units[index]) {
            if (cancelledRef.current) return;
            await uploadForProduct(group, product, getMediaOrder(group, product), settings);
            setUploadProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(workers, units.length) }, worker));
    } catch (err) {
      // Anything unexpected here would otherwise leave the button looking
      // untouched with no explanation — surface it instead.
      setUploadError(err instanceof Error ? err.message : "Something went wrong starting the upload.");
    } finally {
      setUploading(false);
      setCancelling(false);
    }
  };

  const cancelUpload = () => {
    cancelledRef.current = true;
    setCancelling(true);
    for (const controller of productAbortControllersRef.current.values()) controller.abort();
    productAbortControllersRef.current.clear();
  };

  const retryProduct = async (group: MediaSkuGroup, product: MediaSkuProduct) => {
    if (!zip) {
      setRowStatus((prev) => ({
        ...prev,
        [product.id]: {
          state: "error",
          message: 'The zip isn\'t loaded anymore — re-select it above and click "Scan and match products" again.',
        },
      }));
      return;
    }
    // A Cancel pressed earlier must not silently cancel this fresh attempt (unless a bulk run is still winding down).
    if (!uploading) cancelledRef.current = false;
    const settings = toConversionSettings(conversion);
    const orderedItems = getMediaOrder(group, product);
    await uploadForProduct(group, product, orderedItems, settings);
  };

  /** Cuts off whatever this product's upload is currently doing (an in-flight fetch included) and immediately starts a fresh attempt — for a row that's been "Uploading…" too long. */
  const restartProduct = async (group: MediaSkuGroup, product: MediaSkuProduct) => {
    productAbortControllersRef.current.get(product.id)?.abort();
    productAbortControllersRef.current.delete(product.id);
    await retryProduct(group, product);
  };

  // `retryProduct`/`restartProduct` close over state that changes constantly
  // (conversion, zip, etc.), so they get a new identity every render.
  // Routing them through a ref gives the memoized row permanently stable
  // `onRetry`/`onRestart` props while still always calling the freshest
  // implementation.
  const retryProductRef = useRef(retryProduct);
  const restartProductRef = useRef(restartProduct);
  useEffect(() => {
    retryProductRef.current = retryProduct;
    restartProductRef.current = restartProduct;
  });
  const stableRetryProduct = useCallback((group: MediaSkuGroup, product: MediaSkuProduct) => {
    retryProductRef.current(group, product);
  }, []);
  const stableRestartProduct = useCallback((group: MediaSkuGroup, product: MediaSkuProduct) => {
    restartProductRef.current(group, product);
  }, []);

  const estimatedUploadBytes = previewSummary?.estimatedTotal ?? null;

  return (
    <Page
      fullWidth
      title={title}
      backAction={{ content: "Products", url: "/products" }}
    >
      <Layout>
        {beforeZipSection && <Layout.Section>{beforeZipSection}</Layout.Section>}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">Upload a zip of product images</Text>
              <Text as="p" tone="subdued">
                Each top-level folder name is treated as a product SKU, e.g. <b>BT-DIYA-002/photo1.jpg</b>,{" "}
                <b>BT-DIYA-002/photo2.jpg</b>. Every folder is matched against your store below, including
                SKUs shared by more than one product.
              </Text>

              {parseError && (
                <Banner tone="warning" title="Couldn't read the zip">
                  <p>{parseError}</p>
                </Banner>
              )}

              {file ? (
                <Card background="bg-surface-secondary">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Icon source={FileIcon} tone="subdued" />
                      <BlockStack gap="0">
                        <Text as="span" fontWeight="medium">{file.name}</Text>
                        <Text as="span" tone="subdued" variant="bodySm">{formatFileSize(file.size)}</Text>
                      </BlockStack>
                    </InlineStack>
                    <Button icon={XCircleIcon} variant="plain" accessibilityLabel="Remove file" onClick={clearFile} />
                  </InlineStack>
                </Card>
              ) : (
                <DropZone
                  accept=".zip,application/zip"
                  type="file"
                  onDrop={(_files, accepted) => accepted[0] && handleFile(accepted[0])}
                >
                  <DropZone.FileUpload actionTitle="Add zip file" actionHint="or drop a .zip to upload" />
                </DropZone>
              )}

              {parsing && (
                <Text as="span" tone="subdued">Reading zip contents…</Text>
              )}

              {folders.length > 0 && !looked && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" tone="subdued">
                    {folders.length} SKU folder{folders.length === 1 ? "" : "s"} found ·{" "}
                    {folders.reduce((sum, f) => sum + f.imageCount, 0)} images total
                  </Text>
                  <Button variant="primary" loading={looking} onClick={runLookup}>
                    Scan and match products
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {lookupError && (
          <Layout.Section>
            <Banner tone="critical"><p>{lookupError}</p></Banner>
          </Layout.Section>
        )}

        {looked && (
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <div className="stat-grid">
                    <StatTile
                      value={groups.length}
                      label="SKU folders scanned"
                      tone="neutral"
                      active={groupTab === "all"}
                      onClick={() => selectGroupTab("all")}
                    />
                    <StatTile
                      value={totalImages}
                      label="Images total"
                      tone="info"
                      active={groupTab === "all"}
                      onClick={() => selectGroupTab("all")}
                    />
                    <StatTile
                      value={allProducts.length}
                      label="Products matched"
                      tone="success"
                      active={groupTab === "found"}
                      onClick={() => selectGroupTab("found")}
                    />
                    <StatTile
                      value={notFoundGroups.length}
                      label="SKUs not found"
                      tone="critical"
                      active={groupTab === "notFound"}
                      onClick={() => selectGroupTab("notFound")}
                    />
                    <StatTile
                      value={sharedSkuGroups.reduce((sum, g) => sum + g.products.length, 0)}
                      label="Products on shared SKUs"
                      tone="caution"
                      active={groupTab === "shared"}
                      onClick={() => selectGroupTab("shared")}
                    />
                    <StatTile
                      value={foundGroups.length}
                      label="SKUs found in store"
                      tone="neutral"
                      active={groupTab === "found"}
                      onClick={() => selectGroupTab("found")}
                    />
                  </div>

                  {resumeNotice !== null && !uploading && (
                    <Banner tone="info" onDismiss={() => setResumeNotice(null)}>
                      <p>
                        {`This zip was already partly uploaded: ${resumeNotice.toLocaleString()} products are marked done, so Resume carries on with the rest. Use Start over to upload everything again.`}
                      </p>
                    </Banner>
                  )}

                  {showLiveProgress && (
                    <Box background="bg-surface-secondary" borderWidth="025" borderColor="border" borderRadius="300" padding="400">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="end" gap="300">
                          <Text as="h3" variant="headingLg">
                            <AnimatedNumber value={uploadedCount} /> of {allProducts.length.toLocaleString()} products uploaded
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {`${skusDoneCount.toLocaleString()} of ${skuGroupsWithProducts.length.toLocaleString()} SKUs done · ${livePercent.toFixed(livePercent >= 10 || livePercent === 0 ? 0 : 1)}%${uploading ? "" : " — not running"}`}
                          </Text>
                        </InlineStack>
                        <ProgressBar progress={livePercent} tone={failedCount > 0 && !uploading ? "critical" : "primary"} size="small" />
                        <InlineStack gap="200">
                          <Badge tone="success">{`${uploadedCount.toLocaleString()} uploaded`}</Badge>
                          <Badge tone="info">{`${processingCount.toLocaleString()} uploading now`}</Badge>
                          <Badge tone={failedCount > 0 ? "critical" : undefined}>{`${failedCount.toLocaleString()} failed`}</Badge>
                          <Badge tone="attention">{`${Math.max(0, remainingCount - processingCount - failedCount).toLocaleString()} waiting`}</Badge>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}

                  {excludedByStatusGroups.length > 0 && (
                    <Banner tone="info">
                      <p>
                        {excludedByStatusGroups.length} SKU{excludedByStatusGroups.length === 1 ? "" : "s"} matched a
                        product, but every match is hidden by the status filter below.
                      </p>
                    </Banner>
                  )}

                  {estimatedUploadBytes !== null && estimatedUploadBytes > LARGE_UPLOAD_BYTES && (
                    <Banner tone="warning">
                      <p>
                        This will upload about {formatFileSize(estimatedUploadBytes)} from your browser — that may
                        take a while on a slow connection.
                      </p>
                    </Banner>
                  )}

                  {uploadError && (
                    <Banner tone="critical" title="Couldn't start the upload">
                      <p>{uploadError}</p>
                    </Banner>
                  )}

                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="400" blockAlign="center">
                      <Checkbox
                        label="Show image previews (existing + queued)"
                        helpText="Loads product images lazily, only for the page you're viewing. Leave off for a faster-loading list."
                        checked={showMediaPreviews}
                        onChange={setShowMediaPreviews}
                      />
                      <Popover
                        active={statusFilterOpen}
                        onClose={() => setStatusFilterOpen(false)}
                        activator={
                          <Button
                            disclosure
                            onClick={() => setStatusFilterOpen((open) => !open)}
                          >
                            {statusFilter.length === ALL_STATUSES.length
                              ? "All statuses"
                              : statusFilter.length === 0
                                ? "No statuses selected"
                                : `Status: ${statusFilter
                                    .map((s) => STATUS_FILTER_OPTIONS.find((o) => o.value === s)?.label)
                                    .join(", ")}`}
                          </Button>
                        }
                      >
                        <Box padding="300">
                          <ChoiceList
                            title="Only upload to products with status"
                            titleHidden
                            allowMultiple
                            choices={STATUS_FILTER_OPTIONS}
                            selected={statusFilter}
                            onChange={(selected) => {
                              setStatusFilter(selected as ProductStatus[]);
                              setPage(0);
                            }}
                          />
                        </Box>
                      </Popover>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <WorkersField value={workers} onChange={setWorkers} max={MAX_UPLOAD_WORKERS} disabled={uploading} />
                      {/* Always rendered (just disabled when idle) so the Upload button never shifts position
                          when uploading starts — a shifting button was causing clicks to land on the wrong spot. */}
                      <Button onClick={cancelUpload} tone="critical" disabled={!uploading || cancelling} loading={cancelling}>
                        {cancelling ? "Cancelling…" : "Cancel"}
                      </Button>
                      {!uploading && uploadedCount > 0 && (
                        <Button
                          variant="tertiary"
                          tone="critical"
                          onClick={() => {
                            if (file) clearUploadedIds(zipProgressKey(file));
                            setRowStatus({});
                            setResumeNotice(null);
                          }}
                        >
                          Start over
                        </Button>
                      )}
                      {!uploading && uploadedCount > 0 && remainingCount > 0 && (
                        <Button onClick={() => void uploadAll(true)}>{`Resume (${remainingCount.toLocaleString()} remaining)`}</Button>
                      )}
                      <Button
                        variant="primary"
                        loading={uploading}
                        disabled={allProducts.length === 0}
                        onClick={() => void uploadAll()}
                      >
                        {uploading && uploadProgress
                          ? `Uploading… (${uploadProgress.done}/${uploadProgress.total})`
                          : `Upload images (${allProducts.length} products)`}
                      </Button>
                    </InlineStack>
                  </InlineStack>
                </BlockStack>
              </Card>

              <MediaConversionSettings
                value={conversion}
                onChange={handleConversionChange}
                onPreview={runPreviewConversion}
                previewing={previewing}
                previewSummary={previewSummary}
              />

              {groupTab !== "all" && (
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" tone="subdued" variant="bodySm">
                    Showing only{" "}
                    {groupTab === "found"
                      ? "SKUs found in store"
                      : groupTab === "notFound"
                        ? "SKUs not found"
                        : "products on shared SKUs"}{" "}
                    ({tabGroups.length} SKU{tabGroups.length === 1 ? "" : "s"})
                  </Text>
                  <Button variant="plain" onClick={() => selectGroupTab("all")}>
                    Clear filter
                  </Button>
                </InlineStack>
              )}

              {pageGroups.map((group) => (
                <Card key={group.sku} padding="0">
                  <Box padding="300" borderBlockEndWidth="025" borderColor="border" background="bg-surface-secondary">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">SKU {group.sku}</Text>
                      <InlineStack gap="150" blockAlign="center">
                        <Badge tone="info">
                          {`${group.imageCount} image${group.imageCount === 1 ? "" : "s"} to upload`}
                        </Badge>
                        {group.products.length > 1 && (
                          <Badge tone="attention">{`${group.products.length} products share this SKU`}</Badge>
                        )}
                      </InlineStack>
                    </InlineStack>
                  </Box>
                  <BlockStack gap="0">
                    {group.products.length === 0 ? (
                      <Box padding="400">
                        <Text as="p" tone="subdued">
                          {group.matchedBeforeFilter > 0
                            ? "A product matched this SKU, but its status is hidden by the filter above."
                            : "No product found with this SKU."}
                        </Text>
                      </Box>
                    ) : (
                      group.products.map((product) => (
                        <MediaProductRow
                          key={product.id}
                          group={group}
                          product={product}
                          status={rowStatus[product.id]}
                          existingList={existingMedia[product.id]}
                          lastUploadIds={lastUploadCache[product.id] ?? EMPTY_LAST_UPLOAD_IDS}
                          replaceMode={conversion.replaceMode}
                          showMediaPreviews={showMediaPreviews}
                          uploading={uploading}
                          mediaOrderOverride={mediaOrder[product.id]}
                          newFilenames={newFilenamesBySku[group.sku] ?? EMPTY_FILENAMES}
                          newImages={previews[group.sku] ?? EMPTY_PREVIEWS}
                          imageStatusForSku={imageStatus[group.sku] ?? EMPTY_STATUS}
                          onRetry={stableRetryProduct}
                          onRestart={stableRestartProduct}
                          onReorder={handleReorder}
                        />
                      ))
                    )}
                  </BlockStack>
                </Card>
              ))}

              {pageCount > 1 && (
                <InlineStack align="center" gap="150">
                  {Array.from({ length: pageCount }, (_, i) => i).map((i) => {
                    const start = i * PAGE_SIZE;
                    const end = Math.min(start + PAGE_SIZE, tabGroups.length);
                    return (
                      <Button
                        key={i}
                        pressed={i === page}
                        variant={i === page ? "primary" : "secondary"}
                        size="slim"
                        onClick={() => setPage(i)}
                      >
                        {`${start}-${end}`}
                      </Button>
                    );
                  })}
                </InlineStack>
              )}
            </BlockStack>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
