import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { getJob } from "@/lib/storeScraper/store";
import { mapWithConcurrency } from "@/lib/concurrency";
import { UPLOADS_ROOT, fetchImageBytes, filenameFromUrl } from "@/lib/storeScraper/mediaUpload";
import { createBackgroundScanPool } from "@/lib/storeScraper/backgroundScanPool";
import { setExportProgress, clearExportProgress } from "@/lib/storeScraper/exportProgress";
import { getScanCacheEntries, setScanCacheEntry } from "@/lib/storeScraper/backgroundScanCache";
import { MAX_SCAN_WORKERS, DEFAULT_SCAN_WORKERS } from "@/lib/storeScraper/scanWorkerConstants";

const IMAGE_CONCURRENCY_MULTIPLIER = 3;
/**
 * A separate, more lenient worker from the main scan's `backgroundScanWorker.js`
 * — see `verifyFlaggedScanWorker.js`'s own doc comment for why this route
 * specifically can afford a worker that trades some precision for recall
 * (this pool's output is a human-reviewed suggestion, not an unreviewed
 * classification). Do not reuse this worker script for the main scan or
 * the export-time re-check.
 */
const VERIFY_WORKER_SCRIPT = path.join(process.cwd(), "server-workers", "verifyFlaggedScanWorker.js");

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface CorrectedFlaggedImage {
  sku: string;
  productName: string;
  position: number;
  url: string;
}

export interface VerifyFlaggedResult {
  totalFlagged: number;
  checked: number;
  corrected: CorrectedFlaggedImage[];
}

/** Namespaced separately from the main `:bg-scan` progress key so this can run at the same time as (or right after) a full scan without clobbering its numbers. */
function progressKey(jobId: string): string {
  return `${jobId}:verify-flagged`;
}

/**
 * Re-runs the plain-background check against ONLY the images currently
 * flagged as non-plain — a much smaller set than a full rescan. This isn't
 * a no-op re-check: it deliberately uses a DIFFERENT, more lenient worker
 * (`verifyFlaggedScanWorker.js`, a two-ring check) than the main scan's
 * `backgroundScanWorker.js`, specifically to recover plain-background
 * images with a "size in cm" dimension-overlay graphic that the main
 * heuristic's single sampling ring misses. Any previously-flagged image
 * this worker now calls plain is a corrected result — reported back (and
 * written into the cache) so the caller can offer to un-flag it instead of
 * the user having to eyeball every thumbnail by hand. The two-ring worker
 * trades some precision for recall (see its own doc comment) — acceptable
 * here only because the corrected list feeds a human-reviewed selection,
 * not an unreviewed classification; it must not be reused for the main
 * scan or the export-time re-check. `?workers=N` sizes the worker pool,
 * same as the main scan route. Cancelling the request (client abort) stops
 * early, but every image finished before that point already had its cache
 * entry written — nothing already-corrected is lost.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const requestedWorkers = Number(searchParams.get("workers"));
  const workerCount =
    Number.isInteger(requestedWorkers) && requestedWorkers > 0 ? Math.min(requestedWorkers, MAX_SCAN_WORKERS) : undefined;

  let hostname = "store";
  try {
    hostname = new URL(job.options.inputUrl).hostname;
  } catch {
    // keep the fallback
  }

  const cache = getScanCacheEntries(job.id);
  const flaggedEntries = Array.from(cache.entries()).filter(([, entry]) => !entry.isPlain);
  const total = flaggedEntries.length;

  let stopped = false;
  request.signal.addEventListener("abort", () => {
    stopped = true;
  });

  let checked = 0;
  setExportProgress(progressKey(job.id), 0, total);

  const pool = createBackgroundScanPool(workerCount, VERIFY_WORKER_SCRIPT);
  const corrected: CorrectedFlaggedImage[] = [];
  const imageConcurrency = Math.max(1, (workerCount ?? DEFAULT_SCAN_WORKERS) * IMAGE_CONCURRENCY_MULTIPLIER);

  try {
    await mapWithConcurrency(flaggedEntries, imageConcurrency, async ([key, entry]) => {
      if (stopped) return;
      const filename = filenameFromUrl(entry.url, entry.position + 1);
      const localPath = path.join(UPLOADS_ROOT, hostname, entry.sku, filename);
      try {
        const bytes = (await fileExists(localPath))
          ? await readFile(localPath)
          : Buffer.from(await fetchImageBytes(entry.url, job.options.allowInsecureTls));
        if (stopped) return;
        const isPlain = await pool.run(bytes);
        if (stopped) return;
        if (isPlain) {
          setScanCacheEntry(job.id, key, { ...entry, isPlain: true });
          corrected.push({ sku: entry.sku, productName: entry.productName, position: entry.position, url: entry.url });
        }
      } catch {
        // Couldn't re-check this one (dead link, read error) — leave its
        // existing flagged result alone rather than guessing.
      } finally {
        if (!stopped) {
          checked += 1;
          setExportProgress(progressKey(job.id), checked, total);
        }
      }
    });
  } finally {
    await pool.terminate();
    clearExportProgress(progressKey(job.id));
  }

  const result: VerifyFlaggedResult = { totalFlagged: total, checked, corrected };
  return NextResponse.json(result);
}
