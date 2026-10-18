import "server-only";

/**
 * Live "N of M products zipped" progress for an in-flight media export —
 * separate from the job's own scrape progress. The export response itself
 * is a raw zip byte stream (see `mediaExport.ts`), which can't also carry
 * a progress readout, so the client polls this small side-channel while
 * the download's `fetch()` is in flight.
 *
 * `globalThis`-backed for the same `next dev` HMR-survival reason as
 * every other in-memory piece of this feature — see `store.ts`'s own
 * comment for the full rationale. Deliberately NOT persisted to disk:
 * export progress only means anything while that specific export request
 * is still running.
 */
const globalForExportProgress = globalThis as unknown as { __storeScraperExportProgress?: Map<string, { done: number; total: number }> };
const exportProgress = globalForExportProgress.__storeScraperExportProgress ?? new Map<string, { done: number; total: number }>();
if (process.env.NODE_ENV !== "production") {
  globalForExportProgress.__storeScraperExportProgress = exportProgress;
}

export function setExportProgress(jobId: string, done: number, total: number): void {
  exportProgress.set(jobId, { done, total });
}

export function getExportProgress(jobId: string): { done: number; total: number } | null {
  return exportProgress.get(jobId) ?? null;
}

export function clearExportProgress(jobId: string): void {
  exportProgress.delete(jobId);
}
