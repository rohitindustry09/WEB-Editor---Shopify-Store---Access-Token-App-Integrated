import "server-only";
import { mkdir, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";
import { safeFetchBinary } from "@/lib/seoAudit/safeFetch";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getCachedImage, setCachedImage } from "./imageCache";
import { setExportProgress, clearExportProgress } from "./exportProgress";
import { scanEntryKey } from "./backgroundScanCache";
import type { ScrapedProduct } from "./types";

const PRODUCT_CONCURRENCY = 10;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;
const IMAGE_FETCH_ATTEMPTS = 2;
// `safeFetch`'s own default cap (5MB) is sized for arbitrary HTML pages —
// its actual purpose there (see `safeFetch.ts`) is refusing to let an
// untrusted, unbounded page exhaust memory. A real product photo is a
// completely different case: professional catalog photography routinely
// exceeds 5MB, and every one of these URLs comes from the store's own
// discovered image list, not arbitrary user input, so there's no untrusted-
// size concern to guard against the way there is for a scraped page's HTML.
const IMAGE_FETCH_MAX_BYTES = 50 * 1024 * 1024; // 50MB

/**
 * `<project>/uploads/` — plain files on local disk, not a zip streamed
 * through the browser. This app runs locally (`next dev`/`next start` on
 * the same machine the person is using it from), so "on the server" here
 * just means "already on your own disk" — no reason to bundle into an
 * archive and push it through an HTTP response just to have the browser
 * write it back out to disk a moment later. Laid out
 * `uploads/<site-domain>/<SKU>/<original-filename>`, SKU folders
 * uppercased, filenames taken exactly as they appear in the source image
 * URL — no renaming, no format conversion, byte-for-byte as downloaded.
 */
export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Windows/macOS/Linux all forbid these characters in a filename — stripped, not replaced with anything that could collide, since a SKU is already expected to be a short alphanumeric code. */
const UNSAFE_PATH_CHARS = /[\\/:*?"<>|]/g;

/** Exported so `zipExport.ts` can derive the exact same on-disk path a save already wrote to, instead of duplicating this logic. */
export function skuFolderFor(product: ScrapedProduct): string {
  const raw = (product.sku || product.name || product.productId).trim();
  const cleaned = raw.toUpperCase().replace(UNSAFE_PATH_CHARS, "-").trim();
  return cleaned || "UNKNOWN";
}

/** The image's own filename, taken directly from its URL — e.g. `.../BHU1011A_1-scaled.jpg` -> `BHU1011A_1-scaled.jpg`. No renaming: this is deliberately what makes the saved files identical to what the site itself serves. */
export function filenameFromUrl(url: string, fallbackIndex: number): string {
  try {
    const parsed = new URL(url);
    const base = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
    if (base) return base.replace(UNSAFE_PATH_CHARS, "-");
  } catch {
    // fall through to the fallback name below
  }
  return `image-${fallbackIndex}.jpg`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Cache-first image download — see `imageCache.ts`. A cache hit skips the network; a miss fetches and caches for next time. Exported for `zipExport.ts`'s fallback when an image isn't already saved to disk. */
export async function fetchImageBytes(url: string, allowInsecureTls: boolean): Promise<Uint8Array> {
  const cached = await getCachedImage(url);
  if (cached) return cached;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= IMAGE_FETCH_ATTEMPTS; attempt++) {
    try {
      const result = await safeFetchBinary(url, { allowInsecureTls, timeoutMs: IMAGE_FETCH_TIMEOUT_MS, maxBytes: IMAGE_FETCH_MAX_BYTES });
      const bytes = new Uint8Array(result.bytes);
      void setCachedImage(url, bytes);
      return bytes;
    } catch (err) {
      lastErr = err;
      if (attempt < IMAGE_FETCH_ATTEMPTS) await sleep(300);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("failed");
}

export interface SaveMediaResult {
  hostname: string;
  folderPath: string;
  savedCount: number;
  /** Already present on disk from a previous save — this is what makes re-running fast: nothing already-saved gets re-downloaded. */
  skippedCount: number;
  failedCount: number;
  failures: string[];
  /**
   * `<skuFolder>::<position>` for every file actually (re)written to disk
   * this run — everything already on disk was `skippedCount`ed and left
   * completely untouched. The caller uses this to invalidate ONLY these
   * specific images' cached background-scan results, instead of wiping the
   * whole job's scan cache on the assumption that "something on disk
   * changed" — when the overwhelming majority of a real re-save is
   * skip-if-exists no-ops, that assumption throws away far more already-
   * correct work than it protects.
   */
  savedKeys: string[];
}

/**
 * Downloads every scraped product's images and writes them straight to
 * `uploads/<hostname>/<SKU>/<original-filename>` — no zip, no renaming, no
 * exclusions. A file that's already on disk from a previous run is left
 * alone (not re-downloaded), which is what makes re-running this on the
 * same job fast: only genuinely new/missing images cost a network request.
 *
 * Unlike the old browser-streamed zip export, there's no reason to cancel
 * this if the client disconnects — the whole point is that the bytes end
 * up on local disk either way, and a save that keeps running to
 * completion after a page refresh is doing something useful (filling in
 * the local cache), not wasted work streamed to nobody.
 */
export async function saveMediaToUploads(
  jobId: string,
  hostname: string,
  products: ScrapedProduct[],
  allowInsecureTls: boolean,
): Promise<SaveMediaResult> {
  const siteDir = path.join(UPLOADS_ROOT, hostname);
  await mkdir(siteDir, { recursive: true });

  const failures: string[] = [];
  const savedKeys: string[] = [];
  let savedCount = 0;
  let skippedCount = 0;
  let productsDone = 0;
  setExportProgress(jobId, 0, products.length);

  try {
    await mapWithConcurrency(products, PRODUCT_CONCURRENCY, async (product) => {
      const skuFolder = skuFolderFor(product);
      const productDir = path.join(siteDir, skuFolder);
      await mkdir(productDir, { recursive: true });

      await Promise.all(
        product.images.map(async (url, index) => {
          const filename = filenameFromUrl(url, index + 1);
          const finalPath = path.join(productDir, filename);

          if (await fileExists(finalPath)) {
            skippedCount += 1;
            return;
          }

          try {
            const bytes = await fetchImageBytes(url, allowInsecureTls);
            const tempPath = `${finalPath}.tmp`;
            await writeFile(tempPath, bytes);
            await rename(tempPath, finalPath);
            savedCount += 1;
            savedKeys.push(scanEntryKey(skuFolder, index));
          } catch (err) {
            failures.push(`${skuFolder}/${filename} <- ${url}: ${err instanceof Error ? err.message : "failed"}`);
          }
        }),
      );

      productsDone += 1;
      setExportProgress(jobId, productsDone, products.length);
    });
  } finally {
    clearExportProgress(jobId);
  }

  return { hostname, folderPath: siteDir, savedCount, skippedCount, failedCount: failures.length, failures, savedKeys };
}
