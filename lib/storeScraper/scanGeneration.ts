import "server-only";

/**
 * Guards against two scans for the SAME job running server-side at once.
 * Aborting a client `fetch()` (Cancel) doesn't instantly stop the
 * server's in-flight `mapWithConcurrency` loop — there's a real window
 * where the old request is still finishing a batch of images while a new
 * one (Resume, Start over, or the checkbox auto-triggering again) has
 * already started. Both would otherwise write to the same shared progress
 * counter and cache concurrently, which is exactly what made the progress
 * readout jump around ("30 of 19,698" then briefly something smaller
 * before climbing again) — two requests racing to report DIFFERENT
 * `done` counts for the same job.
 *
 * Every scan request calls `startNewScanGeneration` once, up front, and
 * captures the number it gets back. From then on it checks
 * `isCurrentScanGeneration` before every write — starting a NEW scan
 * bumps the counter, which makes every check from the OLDER, still-
 * finishing request return false, turning its remaining writes into
 * no-ops instead of corrupting the new run's state. `globalThis`-backed
 * for the same `next dev` HMR-survival reason as every other in-memory
 * piece of this feature.
 */
const globalForScanGen = globalThis as unknown as { __storeScraperScanGeneration?: Map<string, number> };
const generations = globalForScanGen.__storeScraperScanGeneration ?? new Map<string, number>();
if (process.env.NODE_ENV !== "production") {
  globalForScanGen.__storeScraperScanGeneration = generations;
}

export function startNewScanGeneration(jobId: string): number {
  const next = (generations.get(jobId) ?? 0) + 1;
  generations.set(jobId, next);
  return next;
}

export function isCurrentScanGeneration(jobId: string, generation: number): boolean {
  return generations.get(jobId) === generation;
}
