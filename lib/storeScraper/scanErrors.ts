import "server-only";

export interface ScanErrorEntry {
  sku: string;
  productName: string;
  position: number;
  url: string;
  message: string;
}

/**
 * The actual reason each currently-failing image couldn't be checked — the
 * scan route used to swallow this entirely (a bare `catch { return; }`),
 * which made a persistently-failing "Retry just those" indistinguishable
 * from a transient one: there was no way to tell "this URL 404s, retrying
 * won't help" from "this timed out, try again." In-memory only, same
 * `globalThis` HMR-survival reason as the rest of this feature family —
 * these are meant to reflect the CURRENT scan's state, not survive a
 * restart the way the scan cache itself now does; a restart just means
 * "try again and see," which is the right default for a fetch failure.
 */
const globalForScanErrors = globalThis as unknown as { __storeScraperScanErrors?: Map<string, Map<string, ScanErrorEntry>> };
const scanErrors = globalForScanErrors.__storeScraperScanErrors ?? new Map<string, Map<string, ScanErrorEntry>>();
if (process.env.NODE_ENV !== "production") {
  globalForScanErrors.__storeScraperScanErrors = scanErrors;
}

export function setScanError(jobId: string, key: string, entry: ScanErrorEntry): void {
  let entries = scanErrors.get(jobId);
  if (!entries) {
    entries = new Map();
    scanErrors.set(jobId, entries);
  }
  entries.set(key, entry);
}

/** Called the moment an image that previously failed succeeds — a stale failure record for it would otherwise keep showing up as "still broken" even after a retry actually fixed it. */
export function clearScanError(jobId: string, key: string): void {
  scanErrors.get(jobId)?.delete(key);
}

export function getScanErrors(jobId: string): ScanErrorEntry[] {
  return Array.from(scanErrors.get(jobId)?.values() ?? []);
}

export function clearAllScanErrors(jobId: string): void {
  scanErrors.delete(jobId);
}
