import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { getJob } from "@/lib/storeScraper/store";
import type { ScrapedProduct } from "@/lib/storeScraper/types";
import { mapWithConcurrency } from "@/lib/concurrency";
import { UPLOADS_ROOT, skuFolderFor, filenameFromUrl, fetchImageBytes } from "@/lib/storeScraper/mediaUpload";
import { createBackgroundScanPool } from "@/lib/storeScraper/backgroundScanPool";
import { setExportProgress, clearExportProgress } from "@/lib/storeScraper/exportProgress";
import { getScanCacheEntries, setScanCacheEntry, clearScanCache, scanEntryKey } from "@/lib/storeScraper/backgroundScanCache";
import { setScanError, clearScanError, getScanErrors, clearAllScanErrors } from "@/lib/storeScraper/scanErrors";
import { MAX_SCAN_WORKERS, DEFAULT_SCAN_WORKERS } from "@/lib/storeScraper/scanWorkerConstants";
import { startNewScanGeneration, isCurrentScanGeneration } from "@/lib/storeScraper/scanGeneration";

/**
 * Caps how many images are ever being READ + DECODED at once across the
 * WHOLE scan, not per-product. Each in-flight image holds its full byte
 * buffer in memory until a worker gets to it — with no cap here, a handful
 * of products with many images each could queue hundreds of buffers behind
 * a small worker pool simultaneously, ballooning memory on a large scan
 * (thousands of images) and taking the whole dev server process down.
 * `workerCount * 3` keeps a healthy read-ahead queue for I/O without letting
 * it run away from how fast the workers can actually drain it.
 */
const IMAGE_CONCURRENCY_MULTIPLIER = 3;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface FlaggedBackgroundImage {
  sku: string;
  productName: string;
  /** 0-based, matches the position checkboxes in `ExcludeZipExport`. */
  position: number;
  /** The original scraped image URL — used directly as the thumbnail `src`, same as the product grid elsewhere in this tool. */
  url: string;
}

export interface ScanBackgroundsResult {
  scannedProducts: number;
  scannedImages: number;
  totalImages: number;
  /** True when the scan didn't finish every image — cancelled partway, or the connection dropped. Whatever DID finish is still cached and counted; a later request with the same job (no `?rescan=1`) picks up only the remaining ones. */
  partial: boolean;
  flagged: FlaggedBackgroundImage[];
  /** The actual reason each currently-failing image couldn't be checked — a 404, a timeout, an SSRF block, whatever `fetchImageBytes`/`readFile` actually threw. Distinguishes "this URL is genuinely dead, retrying won't help" from "this timed out, try again." */
  failed: { sku: string; productName: string; position: number; url: string; error: string }[];
  /** How many distinct SKU folders have EVERY one of their images checked, out of how many distinct SKU folders this job actually has. Distinct from `scannedProducts`/`totalImages`: more than one scraped product can share the same SKU folder (see `skuFolderFor`), and a folder only counts as "checked" once every image across all products sharing it is done. */
  skuFoldersChecked: number;
  skuFoldersTotal: number;
}

/**
 * Groups a job's products by their actual SKU folder (not by product —
 * `skuFolderFor` can map more than one scraped product onto the same
 * folder) and reports how many of those folders have every one of their
 * images already in the scan cache. `cacheKeys` is whatever key set the
 * caller already has on hand (either the live scan cache's own keys, or a
 * `Set` built from persisted entries) — `scanEntryKey` is always
 * `<folder>::<position>`, so the folder is recovered by trimming the last
 * `::position` segment rather than a plain `split("::")[0]`, in case a SKU
 * itself ever legitimately contains `::`.
 */
export function computeSkuFolderProgress(products: ScrapedProduct[], cacheKeys: Iterable<string>): { skuFoldersChecked: number; skuFoldersTotal: number } {
  // Max, not sum: products sharing a folder also share `<folder>::<position>`
  // cache keys, so the folder only ever holds as many distinct entries as
  // its longest product has images. Summing made those folders (and the
  // job's overall total) unreachable.
  const folderImageCounts = new Map<string, number>();
  for (const product of products) {
    const folder = skuFolderFor(product);
    folderImageCounts.set(folder, Math.max(folderImageCounts.get(folder) ?? 0, product.images.length));
  }

  const folderDoneCounts = new Map<string, number>();
  for (const key of cacheKeys) {
    const folder = key.slice(0, key.lastIndexOf("::"));
    folderDoneCounts.set(folder, (folderDoneCounts.get(folder) ?? 0) + 1);
  }

  let skuFoldersChecked = 0;
  for (const [folder, total] of folderImageCounts) {
    if ((folderDoneCounts.get(folder) ?? 0) >= total) skuFoldersChecked += 1;
  }
  return { skuFoldersChecked, skuFoldersTotal: folderImageCounts.size };
}

/** How many distinct scan-cache keys (`<folder>::<position>`) a job can ever produce — the real "total" for progress, since products sharing a SKU folder collide on the same keys. */
export function countUniqueScanKeys(products: ScrapedProduct[]): number {
  const keys = new Set<string>();
  for (const product of products) {
    const folder = skuFolderFor(product);
    for (let i = 0; i < product.images.length; i++) keys.add(scanEntryKey(folder, i));
  }
  return keys.size;
}

/** Progress key namespace — distinct from the plain `jobId` key `export-zip`/`save-media` use for THEIR own progress, so a scan running at the same time as a download doesn't clobber either one's numbers. */
function progressKey(jobId: string): string {
  return `${jobId}:bg-scan`;
}

/**
 * Scans every already-saved image for this job (falling back to a live
 * fetch for anything not yet saved to `uploads/`) and flags which ones
 * DON'T look like a plain/uniform studio backdrop. Purely informational:
 * this is what lets the "Export ZIP" panel show a preview (thumbnails + a
 * count) of what `?excludeNonPlain=1` would actually leave out, before the
 * user commits to excluding it. The export route re-checks each image
 * fresh at export time rather than trusting this scan's result.
 *
 * Resumable: every image's result is cached the instant it finishes (see
 * `backgroundScanCache.ts`), not just at the very end — so if the client
 * cancels (closes the request) partway through, or the connection just
 * drops, whatever finished stays cached. The next request for the same
 * job (without `?rescan=1`) skips every already-cached image and only
 * scans what's actually still missing, continuing the same progress
 * instead of starting over. `?rescan=1` clears the cache first and does a
 * full fresh scan. `?workers=N` (1-`MAX_SCAN_WORKERS`) sizes the
 * `worker_threads` pool the CPU-bound decode step runs across.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const { searchParams } = new URL(request.url);
  if (searchParams.get("rescan") === "1") {
    clearScanCache(job.id);
    clearAllScanErrors(job.id);
  }

  // Bumps this job's scan generation — immediately invalidates any OTHER
  // scan request for the same job that's still finishing (see
  // `scanGeneration.ts`'s own note on why that race matters). Every write
  // below checks `isCurrentScanGeneration` first, so a still-draining
  // older request's late writes become no-ops instead of corrupting what
  // THIS request reports.
  const myGeneration = startNewScanGeneration(job.id);

  const requestedWorkers = Number(searchParams.get("workers"));
  const workerCount =
    Number.isInteger(requestedWorkers) && requestedWorkers > 0 ? Math.min(requestedWorkers, MAX_SCAN_WORKERS) : undefined;

  let hostname = "store";
  try {
    hostname = new URL(job.options.inputUrl).hostname;
  } catch {
    // keep the fallback
  }

  const totalImages = countUniqueScanKeys(job.products);
  const alreadyScanned = getScanCacheEntries(job.id);
  // `alreadyScanned` is the SAME live Map `setScanCacheEntry` writes into
  // below, not a snapshot — its `.size` grows in real time as this very
  // run caches new results. Freezing the count here, once, before any of
  // that writing starts is what keeps the progress formula below from
  // double-counting every image this run finishes (once via this count
  // ticking up live, once via `scannedThisRun`) — that compounding double-
  // count was the actual cause of "done" reliably sailing past "total".
  const alreadyScannedCount = alreadyScanned.size;

  let stopped = false;
  request.signal.addEventListener("abort", () => {
    stopped = true;
  });
  const isStale = () => stopped || !isCurrentScanGeneration(job.id, myGeneration);

  let scannedThisRun = 0;
  if (!isStale()) setExportProgress(progressKey(job.id), alreadyScannedCount, totalImages);

  const pool = createBackgroundScanPool(workerCount);

  // Flattened to one job-wide queue (product × image) instead of nesting
  // "N products at once, each with ALL its images at once" — the nested
  // version had no ceiling on total in-flight image buffers, since a
  // product with many images ran every one of them concurrently regardless
  // of how many products were already in flight. This caps total
  // concurrency directly against the worker pool size instead.
  // Deduped by cache key: a second product in the same SKU folder would
  // otherwise re-scan (and overwrite) the first one's entry, and inflate
  // `scannedThisRun` past the unique total.
  const seenKeys = new Set<string>();
  const workItems = job.products.flatMap((product) =>
    product.images
      .map((url, index) => ({ product, url, index }))
      .filter(({ index }) => {
        const key = scanEntryKey(skuFolderFor(product), index);
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      }),
  );
  const imageConcurrency = Math.max(1, (workerCount ?? DEFAULT_SCAN_WORKERS) * IMAGE_CONCURRENCY_MULTIPLIER);

  try {
    await mapWithConcurrency(workItems, imageConcurrency, async ({ product, url, index }) => {
      if (isStale()) return;
      const skuFolder = skuFolderFor(product);
      const key = scanEntryKey(skuFolder, index);
      if (alreadyScanned.has(key)) return; // resumed from a previous run — already have this one

      const filename = filenameFromUrl(url, index + 1);
      const localPath = path.join(UPLOADS_ROOT, hostname, skuFolder, filename);
      try {
        const bytes = (await fileExists(localPath))
          ? await readFile(localPath)
          : Buffer.from(await fetchImageBytes(url, job.options.allowInsecureTls));
        if (isStale()) return;
        const isPlain = await pool.run(bytes);
        if (isStale()) return;
        setScanCacheEntry(job.id, key, { sku: skuFolder, productName: product.name, position: index, url, isPlain });
        clearScanError(job.id, key); // a retry that succeeded — drop any stale failure record for it
      } catch (err) {
        // Couldn't read/fetch this one — leave it uncached rather than
        // guessing; a later rescan will simply try it again. The actual
        // reason is recorded (not just swallowed) so "Retry just those"
        // actually tells you why it's still failing instead of just
        // failing again silently.
        if (!isStale()) {
          setScanError(job.id, key, {
            sku: skuFolder,
            productName: product.name,
            position: index,
            url,
            message: err instanceof Error ? err.message : "Unknown error.",
          });
        }
        return;
      } finally {
        // A stale request's own `scannedThisRun` count means nothing
        // once a newer request has taken over this job's progress —
        // reporting it here would be exactly the "jumps around" bug
        // this whole generation guard exists to prevent.
        if (!isStale()) {
          scannedThisRun += 1;
          setExportProgress(progressKey(job.id), alreadyScannedCount + scannedThisRun, totalImages);
        }
      }
    });
  } finally {
    await pool.terminate();
    // Only clear the progress side-channel if we're still the current
    // generation — a stale request finishing cleanup must NOT wipe out
    // the progress a newer, still-running request is actively reporting.
    if (isCurrentScanGeneration(job.id, myGeneration)) clearExportProgress(progressKey(job.id));
  }

  // A stale scan's own result is never authoritative — whatever superseded
  // it (Resume, Start over, or another tab) owns reporting this job's
  // scan outcome now. Returning early here also avoids handing the client
  // a `ScanBackgroundsResult` that looks final when it's actually just
  // this request's own abandoned, incomplete view of the cache.
  if (!isCurrentScanGeneration(job.id, myGeneration)) {
    return NextResponse.json({ error: "Superseded by a newer scan request." }, { status: 409 });
  }

  const allEntries = getScanCacheEntries(job.id);
  const flagged: FlaggedBackgroundImage[] = [];
  for (const entry of allEntries.values()) {
    if (!entry.isPlain) flagged.push({ sku: entry.sku, productName: entry.productName, position: entry.position, url: entry.url });
  }
  const { skuFoldersChecked, skuFoldersTotal } = computeSkuFolderProgress(job.products, allEntries.keys());

  const result: ScanBackgroundsResult = {
    scannedProducts: job.products.length,
    scannedImages: allEntries.size,
    totalImages,
    partial: allEntries.size < totalImages,
    flagged,
    failed: getScanErrors(job.id).map(({ sku, productName, position, url, message }) => ({ sku, productName, position, url, error: message })),
    skuFoldersChecked,
    skuFoldersTotal,
  };
  return NextResponse.json(result);
}
