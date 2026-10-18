import "server-only";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ZipStreamWriter, waitForDrain } from "./zipStream";
import { UPLOADS_ROOT, skuFolderFor, filenameFromUrl, fetchImageBytes } from "./mediaUpload";
import { setExportProgress, clearExportProgress } from "./exportProgress";
import { createBackgroundScanPool, type BackgroundScanPool } from "./backgroundScanPool";
import { scanEntryKey } from "./backgroundScanCache";
import type { ScrapedProduct } from "./types";

const PRODUCT_CONCURRENCY = 10;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Streams a ZIP built from the products' images, skipping every 0-based
 * image index present in `excludeIndexes` (index 0 = a product's first
 * image). Reads each kept image from the already-saved
 * `uploads/<hostname>/<SKU>/<filename>` copy on disk when it's there —
 * that's the whole point of having saved it earlier via
 * `saveMediaToUploads` — and only falls back to a cache-first network fetch
 * for anything not yet saved locally. This never writes into `uploads/`
 * itself, so the saved media folder is read-only from this export's point
 * of view and stays exactly as it was.
 *
 * Folder layout inside the zip mirrors `uploads/` exactly:
 * `<SKU>/<original-filename>`, no renaming.
 */
export function streamExcludedZip(
  jobId: string,
  hostname: string,
  products: ScrapedProduct[],
  excludeIndexes: Set<number>,
  allowInsecureTls: boolean,
  excludeNonPlainBackgrounds: boolean,
  /** Images the user has manually marked "actually fine, keep it" (via the flagged-preview page's cross/undo) — kept even if the heuristic still calls them non-plain, keyed the same way as `backgroundScanCache.ts` (`sku::position`). */
  keepOverrides: Set<string>,
): ReadableStream<Uint8Array> {
  let stopped = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer = new ZipStreamWriter();
      const encoder = new TextEncoder();
      const failures: string[] = [];
      let productsDone = 0;
      setExportProgress(jobId, 0, products.length);

      // The background-plain check is a CPU-bound JPEG decode, same as the
      // scan route's — only spun up when actually needed (excludeNonPlainBackgrounds),
      // and offloaded to the same worker pool the scan uses instead of
      // running inline on this request's single thread. Running it inline
      // here used to make an export with that option checked dramatically
      // slower than a plain export: every kept image blocked the whole
      // stream on a synchronous decode+sample pass with no parallelism
      // across cores, the exact bottleneck `backgroundScanPool.ts` exists
      // to avoid for the scan route.
      const backgroundPool: BackgroundScanPool | null = excludeNonPlainBackgrounds ? createBackgroundScanPool() : null;

      try {
        await mapWithConcurrency(products, PRODUCT_CONCURRENCY, async (product) => {
          if (stopped) return;
          const skuFolder = skuFolderFor(product);

          const entries = await Promise.all(
            product.images.map(async (url, index) => {
              if (excludeIndexes.has(index)) return null;
              const filename = filenameFromUrl(url, index + 1);
              const localPath = path.join(UPLOADS_ROOT, hostname, skuFolder, filename);
              try {
                const bytes = (await fileExists(localPath))
                  ? new Uint8Array(await readFile(localPath))
                  : await fetchImageBytes(url, allowInsecureTls);
                // Re-checks fresh at export time rather than trusting a
                // possibly-stale earlier scan — cheap since it reuses the
                // bytes just read above, no extra fetch or decode pass.
                // A manual "actually fine, keep it" override always wins,
                // even if the heuristic still disagrees.
                if (
                  backgroundPool &&
                  !keepOverrides.has(scanEntryKey(skuFolder, index)) &&
                  !(await backgroundPool.run(bytes))
                ) {
                  return null;
                }
                return { filename, bytes };
              } catch (err) {
                failures.push(`${skuFolder}/${filename} <- ${url}: ${err instanceof Error ? err.message : "failed"}`);
                return null;
              }
            }),
          );

          if (stopped) return;
          for (const entry of entries) {
            if (entry) controller.enqueue(writer.addEntry(`${skuFolder}/${entry.filename}`, entry.bytes));
          }

          productsDone += 1;
          setExportProgress(jobId, productsDone, products.length);

          // Blocks this worker from picking up its next product until the
          // stream actually has room — see `waitForDrain`'s own note. Also
          // gives up the wait immediately once `cancel()` sets `stopped`
          // (the client disconnected mid-download), rather than looping
          // forever waiting on backpressure that will never clear.
          await waitForDrain(controller, () => stopped);
        });

        if (stopped) return;

        if (failures.length > 0) {
          controller.enqueue(writer.addEntry("_failed-downloads.txt", encoder.encode(failures.join("\n"))));
        }

        controller.enqueue(writer.finish());
        controller.close();
      } catch (err) {
        if (!stopped) controller.error(err);
      } finally {
        clearExportProgress(jobId);
        await backgroundPool?.terminate();
      }
    },
    cancel() {
      stopped = true;
    },
  });
}
