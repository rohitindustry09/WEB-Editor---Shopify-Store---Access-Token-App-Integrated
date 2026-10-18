import "server-only";

/**
 * Cooperative cancellation signal for a running job — the discovery loops
 * (in each engine) and the scrape queue's worker loop poll this between
 * iterations and stop early once it's set, rather than anything being
 * forcibly killed mid-request. Deliberately not persisted to disk:
 * cancellation only makes sense for a job that's actually running in THIS
 * process right now — if the process restarts, nothing is left running to
 * cancel (see `store.ts`'s startup reconciliation for how an
 * interrupted-by-restart job gets finalized instead).
 *
 * Stashed on `globalThis` for the exact same reason as `store.ts`'s job
 * registry: `next dev`'s Turbopack re-evaluates this module on every file
 * save. Without this, the cancel API route (which calls `requestCancel`)
 * and the actual running scrape loop (which calls `isCancelRequested`) can
 * end up reading two DIFFERENT `Set` instances after an edit — the route
 * writes to the fresh one, the loop is still checking the stale one, and
 * cancelling silently does nothing. Confirmed as the real cause of a
 * reported "Cancel doesn't stop it" bug, not a hypothetical.
 */
const globalForCancellation = globalThis as unknown as { __storeScraperCancelledJobIds?: Set<string> };
const cancelledJobIds = globalForCancellation.__storeScraperCancelledJobIds ?? new Set<string>();
if (process.env.NODE_ENV !== "production") {
  globalForCancellation.__storeScraperCancelledJobIds = cancelledJobIds;
}

export function requestCancel(jobId: string): void {
  cancelledJobIds.add(jobId);
}

export function isCancelRequested(jobId: string): boolean {
  return cancelledJobIds.has(jobId);
}

export function clearCancelFlag(jobId: string): void {
  cancelledJobIds.delete(jobId);
}
