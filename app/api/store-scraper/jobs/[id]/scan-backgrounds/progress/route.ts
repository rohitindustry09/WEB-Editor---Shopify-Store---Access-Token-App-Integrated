import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getExportProgress } from "@/lib/storeScraper/exportProgress";
import { getScanCacheEntries } from "@/lib/storeScraper/backgroundScanCache";
import { getScanErrors } from "@/lib/storeScraper/scanErrors";
import { getJob } from "@/lib/storeScraper/store";
import { computeSkuFolderProgress, countUniqueScanKeys, type FlaggedBackgroundImage } from "../route";

/**
 * Polled by the client while a background-type scan is in flight — the
 * scan itself is one long-running request, so this small side-channel is
 * how "N of M images scanned" progress AND "here's what's been flagged so
 * far" both reach the UI live, instead of the flagged-images row only
 * appearing once the whole scan finishes. Reads straight from the same
 * per-image cache the scan route writes to as it goes (see
 * `backgroundScanCache.ts`), so this never does any decoding itself — just
 * reports what's already there.
 *
 * `getExportProgress` is in-memory only and empty right after a server
 * restart even though the scan cache itself survived one (it's now
 * persisted to disk — see `backgroundScanCache.ts`). Without a fallback,
 * the client would see `{done:0,total:0}` and conclude nothing had ever
 * been scanned, hiding the "Resume scan" banner for a batch that's
 * actually most of the way done. Falling back to the cache's own size (and
 * the job's own image count for the total) is what makes a scan look
 * resumable again immediately after a restart, not just within one
 * continuously-running process.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(_request);
  if (denied) return denied;
  const { id } = await params;
  const liveProgress = getExportProgress(`${id}:bg-scan`);

  const cache = getScanCacheEntries(id);
  const flagged: FlaggedBackgroundImage[] = [];
  for (const entry of cache.values()) {
    if (!entry.isPlain) flagged.push({ sku: entry.sku, productName: entry.productName, position: entry.position, url: entry.url });
  }

  const job = await getJob(id);

  let progress = liveProgress;
  if (!progress) {
    const totalImages = job ? countUniqueScanKeys(job.products) : 0;
    progress = { done: cache.size, total: totalImages };
  }

  const folderProgress = job
    ? computeSkuFolderProgress(job.products, cache.keys())
    : { skuFoldersChecked: 0, skuFoldersTotal: 0 };

  return NextResponse.json({ ...progress, flagged, failed: getScanErrors(id), ...folderProgress });
}
