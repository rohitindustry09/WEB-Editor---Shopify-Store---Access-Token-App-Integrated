"use client";
/* eslint-disable react-hooks/set-state-in-effect -- reading persisted overrides from localStorage after mount, so SSR and the first client render match before swapping in the saved value (same pattern as MediaUploadForm.tsx) */

import { useEffect, useRef, useState } from "react";
import { Box, BlockStack, InlineStack, InlineGrid, Text, Checkbox, Button, Spinner, Banner, Divider, ProgressBar, Modal } from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { ChevronLeftIcon, ChevronRightIcon } from "@shopify/polaris-icons";
import type { ScrapeJobSummary } from "@/lib/storeScraper/types";
import type { FlaggedBackgroundImage, ScanBackgroundsResult } from "@/app/api/store-scraper/jobs/[id]/scan-backgrounds/route";
import type { MediaReport } from "@/app/api/store-scraper/jobs/[id]/media-report/route";
import { MAX_SCAN_WORKERS, DEFAULT_SCAN_WORKERS } from "@/lib/storeScraper/scanWorkerConstants";
import { loadKeptOverrides, overrideKey } from "@/lib/storeScraper/flaggedOverrides";

type Props = {
  job: ScrapeJobSummary;
};

const SLIDER_PAGE_SIZE = 20;
/** ~6s of polls (at 600ms) with no export progress ever showing up — the zip finished before the first poll, so stop the spinner instead of waiting forever. */
const MAX_EMPTY_DOWNLOAD_POLLS = 10;
const WORKER_COUNT_OPTIONS = Array.from({ length: MAX_SCAN_WORKERS }, (_, i) => {
  const count = i + 1;
  return { value: String(count), label: `${count} worker${count === 1 ? "" : "s"}` };
});

function hostnameOf(inputUrl: string): string {
  try {
    return new URL(inputUrl).hostname;
  } catch {
    return "store";
  }
}

interface FailedScanImage {
  sku: string;
  productName: string;
  position: number;
  url: string;
  error: string;
}

/** Shape of both the mid-scan poll and the mount-restore fetch — the scan's own real-time side-channel. */
interface ScanProgressPayload {
  done: number;
  total: number;
  flagged: FlaggedBackgroundImage[];
  failed: FailedScanImage[];
  skuFoldersChecked: number;
  skuFoldersTotal: number;
}

/** The actual reason each currently-failing image couldn't be checked — replaces a bare "N couldn't be checked" count with something you can act on (a genuinely dead URL vs. a transient timeout). */
function FailedImagesList({ failed }: { failed: FailedScanImage[] }) {
  if (failed.length === 0) return null;
  const visible = failed.slice(0, 8);
  return (
    <BlockStack gap="100">
      {visible.map((f) => (
        <InlineStack key={`${f.sku}-${f.position}`} gap="150" blockAlign="center" wrap={false}>
          <Text as="span" variant="bodySm" fontWeight="medium" truncate>{f.productName || f.sku}</Text>
          <Text as="span" variant="bodySm" tone="critical" truncate>{f.error}</Text>
        </InlineStack>
      ))}
      {failed.length > visible.length && (
        <Text as="span" variant="bodySm" tone="subdued">{`+ ${failed.length - visible.length} more`}</Text>
      )}
    </BlockStack>
  );
}

const MEDIA_REPORT_SKU_LIMIT = 40;
const MEDIA_REPORT_IMAGES_PER_SKU_LIMIT = 10;

/** Two distinct things the SKU-folder count alone can't show: which SKUs are shared by more than one scraped product (why folder count < product count), and — checked fresh against the actual uploads/ folder, not any cache — exactly which images genuinely aren't saved to disk yet. */
function MediaReportView({ report }: { report: MediaReport }) {
  const visibleDuplicates = report.duplicateSkuGroups.slice(0, MEDIA_REPORT_SKU_LIMIT);
  const visibleMissing = report.missingSkus.slice(0, MEDIA_REPORT_SKU_LIMIT);

  return (
    <BlockStack gap="300">
      <BlockStack gap="150">
        <Text as="h4" fontWeight="semibold">
          {report.duplicateSkuGroups.length > 0
            ? `${report.duplicateSkuGroups.length} SKU${report.duplicateSkuGroups.length === 1 ? "" : "s"} shared by more than one product`
            : "No SKUs are shared between products"}
        </Text>
        {visibleDuplicates.map((group) => (
          <BlockStack key={group.sku} gap="050">
            <Text as="span" variant="bodySm" fontWeight="medium">{group.sku}</Text>
            <Text as="span" variant="bodySm" tone="subdued">{group.products.map((p) => p.name).join(" • ")}</Text>
          </BlockStack>
        ))}
        {report.duplicateSkuGroups.length > visibleDuplicates.length && (
          <Text as="span" variant="bodySm" tone="subdued">{`+ ${report.duplicateSkuGroups.length - visibleDuplicates.length} more SKUs`}</Text>
        )}
      </BlockStack>

      <Divider />

      <BlockStack gap="150">
        <Text as="h4" fontWeight="semibold">
          {report.missingCount > 0
            ? `${report.missingCount.toLocaleString()} image${report.missingCount === 1 ? "" : "s"} missing from uploads/ across ${report.missingSkus.length.toLocaleString()} SKU folder${report.missingSkus.length === 1 ? "" : "s"}`
            : `All ${report.totalImages.toLocaleString()} images are saved to uploads/`}
        </Text>
        {visibleMissing.map((skuReport) => (
          <BlockStack key={skuReport.sku} gap="050">
            <Text as="span" variant="bodySm" fontWeight="medium">
              {`${skuReport.sku} — ${skuReport.missing.length.toLocaleString()} of ${skuReport.totalImages.toLocaleString()} missing`}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">{skuReport.productNames.join(" • ")}</Text>
            {skuReport.missing.slice(0, MEDIA_REPORT_IMAGES_PER_SKU_LIMIT).map((img) => (
              <Text as="span" key={`${skuReport.sku}-${img.position}`} variant="bodySm" tone="caution" truncate>
                {`  position ${img.position} — ${img.url}`}
              </Text>
            ))}
            {skuReport.missing.length > MEDIA_REPORT_IMAGES_PER_SKU_LIMIT && (
              <Text as="span" variant="bodySm" tone="subdued">{`  + ${skuReport.missing.length - MEDIA_REPORT_IMAGES_PER_SKU_LIMIT} more images`}</Text>
            )}
          </BlockStack>
        ))}
        {report.missingSkus.length > visibleMissing.length && (
          <Text as="span" variant="bodySm" tone="subdued">{`+ ${report.missingSkus.length - visibleMissing.length} more SKU folders with missing images`}</Text>
        )}
      </BlockStack>
    </BlockStack>
  );
}

/** A small thumbnail strip, 20 visible at once, paged with prev/next arrows — for previewing exactly which images `excludeNonPlain` would leave out before committing to the export. */
function BackgroundScanSlider({ images }: { images: FlaggedBackgroundImage[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(images.length / SLIDER_PAGE_SIZE);
  const visible = images.slice(page * SLIDER_PAGE_SIZE, page * SLIDER_PAGE_SIZE + SLIDER_PAGE_SIZE);

  return (
    <InlineStack gap="150" blockAlign="center" wrap={false}>
      <Button
        icon={ChevronLeftIcon}
        accessibilityLabel="Previous"
        variant="tertiary"
        disabled={page === 0}
        onClick={() => setPage((p) => Math.max(0, p - 1))}
      />
      <div style={{ display: "flex", gap: 6, overflowX: "hidden", flex: 1 }}>
        {visible.map((img) => (
          // Thumbnails of scraped store images from arbitrary hosts — next/image's optimiser doesn't apply to them.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${img.sku}-${img.position}`}
            src={img.url}
            alt={img.productName}
            title={`${img.productName} — position ${img.position}`}
            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
          />
        ))}
      </div>
      <Button
        icon={ChevronRightIcon}
        accessibilityLabel="Next"
        variant="tertiary"
        disabled={page >= pageCount - 1}
        onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
      />
      <Text as="span" tone="subdued" variant="bodySm">
        {`${page + 1}/${pageCount}`}
      </Text>
    </InlineStack>
  );
}

/**
 * A separate zip-export path from "Save Media to Server" — that flow
 * already wrote every image to `uploads/<site>/<SKU>/...` untouched and
 * unfiltered. This one builds an on-demand ZIP that leaves out whichever
 * 0-based image positions are checked, plus (optionally) any image whose
 * background isn't a plain studio backdrop — reading from that same
 * `uploads/` folder wherever possible (fast, no re-download) without ever
 * writing back into it. See `export-zip/route.ts` and `zipExport.ts`.
 */
export function ExcludeZipExport({ job }: Props) {
  const [excludedIndexes, setExcludedIndexes] = useState<Set<number>>(new Set());
  const [excludeNonPlain, setExcludeNonPlain] = useState(false);
  const [workerCount, setWorkerCount] = useState(DEFAULT_SCAN_WORKERS);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  // Updated on every progress poll while scanning, straight from the
  // scan's own live cache — the found-images row grows in real time
  // instead of only appearing once the whole (possibly multi-minute) scan
  // finishes.
  const [liveFlagged, setLiveFlagged] = useState<FlaggedBackgroundImage[]>([]);
  const [liveFailed, setLiveFailed] = useState<FailedScanImage[]>([]);
  const [skuFolders, setSkuFolders] = useState<{ checked: number; total: number } | null>(null);
  const [scanResult, setScanResult] = useState<ScanBackgroundsResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  // Set only when the user actually clicked Cancel mid-scan — distinct
  // from `scanError`, since this isn't a failure: whatever finished before
  // the cancel is cached server-side (see `backgroundScanCache.ts`), and
  // "Resume scan" continues from exactly there instead of restarting.
  const [cancelledAt, setCancelledAt] = useState<{ done: number; total: number } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgressRef = useRef<{ done: number; total: number } | null>(null);
  // Images marked "actually fine, keep it" from the dedicated flagged-
  // preview grid page (or a previous session) — same localStorage key, so
  // either page reflects the other's changes on next load. Kept out of
  // both the displayed flagged list/count and the actual export.
  const [keptOverrides, setKeptOverrides] = useState<Set<string>>(new Set());
  // Export used to be one click straight to a download — this is what
  // makes it a deliberate two-step instead: clicking "Review & export"
  // just opens this, showing exactly what the current settings (plus any
  // grid edits, live via `keptOverrides`) will actually leave out, before
  // the real download link is exposed at all.
  const [reviewOpen, setReviewOpen] = useState(false);
  // The download used to be a plain `<Button url={exportUrl}>` — a raw
  // browser navigation the app has zero visibility into once clicked, even
  // though the export route already reports "N of M products zipped"
  // progress server-side (the same side-channel `export-media-progress`
  // already polls for the save-to-server flow). Fetching it manually
  // instead lets this poll that same progress while the request is in
  // flight, then hands the finished response off to the browser as a
  // regular file save.
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null);
  const downloadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
    },
    [],
  );
  // Fetched on demand only (not auto-loaded) — it checks disk for every
  // single image across the whole job, which is real work on a
  // 20,000-image store and has no reason to run unless actually asked for.
  const [mediaReport, setMediaReport] = useState<MediaReport | null>(null);
  const [mediaReportLoading, setMediaReportLoading] = useState(false);
  const [mediaReportError, setMediaReportError] = useState<string | null>(null);

  const handleLoadMediaReport = async () => {
    setMediaReportLoading(true);
    setMediaReportError(null);
    try {
      const res = await fetch(`/api/store-scraper/jobs/${job.id}/media-report`);
      const data = (await res.json()) as MediaReport & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't build the media report.");
      setMediaReport(data);
    } catch (err) {
      setMediaReportError(err instanceof Error ? err.message : "Couldn't build the media report.");
    } finally {
      setMediaReportLoading(false);
    }
  };

  useEffect(() => {
    setKeptOverrides(loadKeptOverrides(job.id));
    // The dedicated flagged-preview grid runs in its own tab — the native
    // `storage` event is what tells THIS tab an override changed over
    // there, so the count/list here stays accurate without a manual
    // refresh.
    const onStorage = () => setKeptOverrides(loadKeptOverrides(job.id));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [job.id]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // A scan that finished — fully or cancelled partway — in an EARLIER page
  // load (or an earlier server process entirely, now that the scan cache
  // is disk-persisted — see `backgroundScanCache.ts`) leaves its results
  // sitting server-side, but `scanResult`/`cancelledAt` are plain component
  // state that knows nothing about any of that. Without this, reopening
  // the page (or the server just restarting) always looked like a clean
  // slate — no "View in grid", no flagged summary, no "Resume scan" banner
  // — even though the server had, say, 20,000 already-checked images
  // sitting there ready to pick up from. One-time check on mount: rebuild
  // whichever view (finished result, or a resumable partial one) the
  // cached progress actually represents.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/store-scraper/jobs/${job.id}/scan-backgrounds/progress`);
        if (!res.ok || cancelled) return;
        const progress = (await res.json()) as ScanProgressPayload;
        if (progress.total === 0) return;
        setExcludeNonPlain(true);
        setSkuFolders({ checked: progress.skuFoldersChecked, total: progress.skuFoldersTotal });
        if (progress.done < progress.total) {
          setCancelledAt({ done: progress.done, total: progress.total });
          setLiveFlagged(progress.flagged);
          setLiveFailed(progress.failed);
        } else {
          setScanResult({
            scannedProducts: job.productCount,
            scannedImages: progress.done,
            totalImages: progress.total,
            partial: progress.failed.length > 0,
            flagged: progress.flagged,
            failed: progress.failed,
            skuFoldersChecked: progress.skuFoldersChecked,
            skuFoldersTotal: progress.skuFoldersTotal,
          });
        }
      } catch {
        // No cached progress reachable — just show the normal empty state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id, job.productCount]);

  if (job.maxImageCount === 0 || job.productCount === 0) return null;

  const withoutOverrides = (images: FlaggedBackgroundImage[]) =>
    images.filter((img) => !keptOverrides.has(overrideKey(img.sku, img.position)));

  const toggleIndex = (index: number, checked: boolean) => {
    setExcludedIndexes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const runScan = async (rescan: boolean) => {
    setScanning(true);
    setScanError(null);
    setCancelledAt(null);
    setScanProgress({ done: 0, total: 0 });
    setLiveFlagged([]);
    setLiveFailed([]);
    lastProgressRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;

    // The scan itself is one long-running request with no way to carry
    // progress in its own response — this polls the small side-channel
    // `scan-backgrounds/progress` route fills in while it's in flight, the
    // same pattern the zip-download progress bar elsewhere in this tool
    // already uses.
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/store-scraper/jobs/${job.id}/scan-backgrounds/progress`);
        if (res.ok) {
          const progress = (await res.json()) as ScanProgressPayload;
          lastProgressRef.current = { done: progress.done, total: progress.total };
          setScanProgress({ done: progress.done, total: progress.total });
          setLiveFlagged(progress.flagged);
          setLiveFailed(progress.failed);
          setSkuFolders({ checked: progress.skuFoldersChecked, total: progress.skuFoldersTotal });
        }
      } catch {
        // A missed poll tick just means the bar doesn't tick forward this
        // round — the next one (or the final result) catches it up.
      }
    }, 400);

    try {
      const url =
        `/api/store-scraper/jobs/${job.id}/scan-backgrounds?workers=${workerCount}` + (rescan ? "&rescan=1" : "");
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Scan failed (${res.status}).`);
      const result = (await res.json()) as ScanBackgroundsResult;
      setScanResult(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // The server keeps whatever finished before the abort (it's
        // written to cache per-image, not batched to the end) — this just
        // tells the UI to offer "Resume" instead of treating it as a
        // failure. `lastProgressRef` is whatever the last successful poll
        // saw, since the aborted fetch itself never returns a response.
        setCancelledAt(lastProgressRef.current ?? { done: 0, total: 0 });
      } else {
        setScanError(err instanceof Error ? err.message : "Couldn't scan images for their background type.");
      }
    } finally {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      abortRef.current = null;
      setScanning(false);
      setScanProgress(null);
    }
  };

  const cancelScan = () => {
    abortRef.current?.abort();
  };

  const toggleExcludeNonPlain = (checked: boolean) => {
    setExcludeNonPlain(checked);
    if (checked && !scanResult && !cancelledAt && !scanning) void runScan(false);
  };

  const sortedIndexes = [...excludedIndexes].sort((a, b) => a - b);
  const hostname = hostnameOf(job.options.inputUrl);
  const filename = sortedIndexes.length > 0 ? `${hostname}.excluded.${sortedIndexes.join(".and.")}.zip` : `${hostname}.zip`;
  const keepParam =
    keptOverrides.size > 0 ? `&keep=${Array.from(keptOverrides).map(encodeURIComponent).join(",")}` : "";
  const exportUrl =
    `/api/store-scraper/jobs/${job.id}/export-zip?exclude=${sortedIndexes.join(",")}` +
    (excludeNonPlain ? "&excludeNonPlain=1" : "") +
    keepParam;

  const handleDownloadZip = () => {
    setReviewOpen(false);
    setDownloading(true);
    setDownloadProgress({ done: 0, total: 0 });

    // Triggering the download via a real anchor click (not `fetch` +
    // `blob()`) is deliberate: a multi-thousand-image export can be many
    // gigabytes, and buffering that whole response into a browser Blob
    // before saving anything to disk risks exhausting the tab's memory on
    // exactly the large exports where this matters most. This way the
    // browser streams the response straight to disk the normal way, the
    // same as before — the only thing new is polling the export's own
    // progress side-channel (the route already reports "N of M products
    // packed", previously never surfaced anywhere) alongside it.
    let sawProgress = false;
    let emptyPolls = 0;
    const finish = () => {
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
      downloadPollRef.current = null;
      setDownloading(false);
      setDownloadProgress(null);
    };
    if (downloadPollRef.current) clearInterval(downloadPollRef.current);
    const progressInterval = setInterval(() => {
      void fetch(`/api/store-scraper/jobs/${job.id}/export-media-progress`)
        .then((r) => r.json())
        .then((p: { done: number; total: number }) => {
          if (p.total > 0) sawProgress = true;
          else emptyPolls += 1;
          setDownloadProgress(p);
          // The route clears this the moment the zip finishes streaming —
          // once we've actually seen it running, a reset back to zero
          // means it's done (not "hasn't started yet"). A small export can
          // finish before the first poll ever lands, so if we still haven't
          // seen it running after a few empty polls, give up rather than
          // spin forever.
          if (p.total === 0 && (sawProgress || emptyPolls >= MAX_EMPTY_DOWNLOAD_POLLS)) finish();
        })
        .catch(() => {
          // Progress is a nice-to-have readout — a failed poll just means the next tick tries again.
        });
    }, 600);
    downloadPollRef.current = progressInterval;

    const link = document.createElement("a");
    link.href = exportUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const visibleLiveFlagged = withoutOverrides(liveFlagged);
  const visibleFinalFlagged = scanResult ? withoutOverrides(scanResult.flagged) : [];
  // Whichever flagged count is currently live — mid-scan, or a finished
  // result — so the review step always reflects the latest grid edits
  // regardless of which state the scan happens to be in right now.
  const backgroundExcludedCount = scanResult ? visibleFinalFlagged.length : visibleLiveFlagged.length;

  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <BlockStack gap="300">
        <BlockStack gap="050">
          <Text as="h3" variant="headingSm">Export ZIP with image positions excluded</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {`Products here have up to ${job.maxImageCount} images (position 0 is the first). Check the positions to leave out of the zip — everything else is read straight from the already-saved uploads/ folder, which is never modified by this.`}
          </Text>
        </BlockStack>
        <InlineGrid columns={{ xs: 3, sm: 5, md: 8 }} gap="150">
          {Array.from({ length: job.maxImageCount }, (_, index) => (
            <Checkbox
              key={index}
              label={`${index}`}
              checked={excludedIndexes.has(index)}
              onChange={(checked) => toggleIndex(index, checked)}
            />
          ))}
        </InlineGrid>

        <Divider />

        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
            <Checkbox
              label="Exclude images with a non-plain background (lifestyle photos, gradients, props — anything that isn't a plain studio backdrop)"
              checked={excludeNonPlain}
              onChange={toggleExcludeNonPlain}
            />
            <div style={{ minWidth: 130 }}>
              <Select
                label="Workers"
                labelHidden
                options={WORKER_COUNT_OPTIONS}
                value={String(workerCount)}
                onChange={(v) => setWorkerCount(Number(v))}
                disabled={scanning}
              />
            </div>
          </InlineStack>
          {scanning && (
            <BlockStack gap="100">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <InlineStack gap="150" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="span" tone="subdued" variant="bodySm">
                    {scanProgress && scanProgress.total > 0
                      ? `Scanning — ${scanProgress.done.toLocaleString()} of ${scanProgress.total.toLocaleString()} images checked (${workerCount} worker${workerCount === 1 ? "" : "s"})…`
                      : `Scanning ${job.productCount.toLocaleString()} products' images…`}
                  </Text>
                </InlineStack>
                <Button onClick={cancelScan} tone="critical" variant="tertiary">Cancel</Button>
              </InlineStack>
              {scanProgress && scanProgress.total > 0 && (
                <ProgressBar progress={Math.round((scanProgress.done / scanProgress.total) * 100)} size="small" tone="primary" />
              )}
              {skuFolders && skuFolders.total > 0 && (
                <Text as="span" tone="subdued" variant="bodySm">
                  {`${skuFolders.checked.toLocaleString()} of ${skuFolders.total.toLocaleString()} SKU folders fully checked`}
                </Text>
              )}
              {liveFailed.length > 0 && (
                <BlockStack gap="100">
                  <Text as="span" tone="caution" variant="bodySm">
                    {`${liveFailed.length.toLocaleString()} couldn't be checked so far:`}
                  </Text>
                  <FailedImagesList failed={liveFailed} />
                </BlockStack>
              )}
              {visibleLiveFlagged.length > 0 && (
                <BlockStack gap="100">
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <Text as="span" tone="subdued" variant="bodySm">
                      {`${visibleLiveFlagged.length.toLocaleString()} flagged so far…`}
                    </Text>
                    <Button variant="plain" url={`/store-scraper-preview/${job.id}`} target="_blank">
                      View all in grid
                    </Button>
                  </InlineStack>
                  <BackgroundScanSlider images={visibleLiveFlagged} />
                </BlockStack>
              )}
            </BlockStack>
          )}
          {cancelledAt && !scanning && (
            <Banner tone="info">
              <BlockStack gap="200">
                <p>
                  {`Cancelled — ${cancelledAt.done.toLocaleString()} of ${cancelledAt.total.toLocaleString()} images were already checked and are cached${skuFolders && skuFolders.total > 0 ? ` (${skuFolders.checked.toLocaleString()} of ${skuFolders.total.toLocaleString()} SKU folders fully checked)` : ""}. Resume to continue from there instead of starting over.`}
                </p>
                <InlineStack gap="200">
                  <Button onClick={() => void runScan(false)} variant="primary">Resume scan</Button>
                  <Button onClick={() => void runScan(true)}>Start over</Button>
                </InlineStack>
              </BlockStack>
            </Banner>
          )}
          {scanError && (
            <Banner tone="warning" onDismiss={() => setScanError(null)}>
              <p>{scanError}</p>
            </Banner>
          )}
          {excludeNonPlain && scanResult && !scanning && (
            <BlockStack gap="150">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <BlockStack gap="050">
                  <Text as="span" tone="subdued" variant="bodySm">
                    {`${visibleFinalFlagged.length.toLocaleString()} of ${scanResult.scannedImages.toLocaleString()} scanned images flagged — these will be left out of the zip.`}
                    {keptOverrides.size > 0 ? ` (${keptOverrides.size} manually kept)` : ""}
                  </Text>
                  {scanResult.skuFoldersTotal > 0 && (
                    <Text as="span" tone="subdued" variant="bodySm">
                      {`${scanResult.skuFoldersChecked.toLocaleString()} of ${scanResult.skuFoldersTotal.toLocaleString()} SKU folders fully checked`}
                    </Text>
                  )}
                </BlockStack>
                <InlineStack gap="300">
                  <Button variant="plain" url={`/store-scraper-preview/${job.id}`} target="_blank">
                    View all in grid
                  </Button>
                  <Button variant="plain" onClick={() => void runScan(true)}>Rescan</Button>
                </InlineStack>
              </InlineStack>
              {scanResult.failed.length > 0 && (
                <BlockStack gap="100">
                  <InlineStack gap="150" blockAlign="center">
                    <Text as="span" tone="caution" variant="bodySm">
                      {`${scanResult.failed.length.toLocaleString()} image${scanResult.failed.length === 1 ? "" : "s"} couldn't be checked:`}
                    </Text>
                    <Button variant="plain" onClick={() => void runScan(false)}>Retry just those</Button>
                  </InlineStack>
                  <FailedImagesList failed={scanResult.failed} />
                </BlockStack>
              )}
              {visibleFinalFlagged.length > 0 && <BackgroundScanSlider images={visibleFinalFlagged} />}

              <Divider />
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" tone="subdued" variant="bodySm">
                  Shared SKUs and images genuinely missing from uploads/ — checked fresh against disk, not this scan&apos;s own cache.
                </Text>
                <Button variant="plain" onClick={() => void handleLoadMediaReport()} loading={mediaReportLoading}>
                  {mediaReport ? "Refresh media report" : "Show missing media report"}
                </Button>
              </InlineStack>
              {mediaReportError && (
                <Banner tone="warning" onDismiss={() => setMediaReportError(null)}>
                  <p>{mediaReportError}</p>
                </Banner>
              )}
              {mediaReport && <MediaReportView report={mediaReport} />}
            </BlockStack>
          )}
        </BlockStack>

        <InlineStack align="space-between" blockAlign="center" gap="200">
          <Text as="span" tone="subdued" variant="bodySm">{filename}</Text>
          <Button variant="primary" onClick={() => setReviewOpen(true)}>Review &amp; export</Button>
        </InlineStack>

        <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title="Review before export">
          <Modal.Section>
            <BlockStack gap="300">
              {sortedIndexes.length > 0 && (
                <Text as="p">
                  {`Position${sortedIndexes.length === 1 ? "" : "s"} ${sortedIndexes.join(", ")} excluded from every product that has them.`}
                </Text>
              )}
              {excludeNonPlain && (
                <Text as="p">
                  {scanning
                    ? `Scan still running — exporting now uses whatever's been checked so far (${backgroundExcludedCount.toLocaleString()} flagged for a non-plain background out of ${(scanProgress?.done ?? 0).toLocaleString()} checked).`
                    : `${backgroundExcludedCount.toLocaleString()} image${backgroundExcludedCount === 1 ? "" : "s"} excluded for a non-plain background${scanResult ? ` (out of ${scanResult.scannedImages.toLocaleString()} checked)` : ""}.`}
                  {keptOverrides.size > 0 ? ` ${keptOverrides.size.toLocaleString()} manually kept via the grid.` : ""}
                </Text>
              )}
              {sortedIndexes.length === 0 && !excludeNonPlain && (
                <Text as="p" tone="subdued">Nothing excluded — every image will be included as-is.</Text>
              )}
              <Text as="p" tone="subdued" variant="bodySm">{filename}</Text>
            </BlockStack>
          </Modal.Section>
          <Modal.Section>
            <InlineStack align="end" gap="200">
              <Button onClick={() => setReviewOpen(false)} disabled={downloading}>Keep editing</Button>
              <Button variant="primary" onClick={handleDownloadZip} loading={downloading}>
                Download ZIP
              </Button>
            </InlineStack>
          </Modal.Section>
        </Modal>

        {downloading && (
          <BlockStack gap="150">
            <InlineStack gap="150" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" tone="subdued" variant="bodySm">
                {downloadProgress && downloadProgress.total > 0
                  ? `Building zip — ${downloadProgress.done.toLocaleString()} of ${downloadProgress.total.toLocaleString()} products packed…`
                  : "Building zip…"}
              </Text>
            </InlineStack>
            {downloadProgress && downloadProgress.total > 0 && (
              <ProgressBar progress={Math.round((downloadProgress.done / downloadProgress.total) * 100)} size="small" tone="primary" />
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Box>
  );
}
