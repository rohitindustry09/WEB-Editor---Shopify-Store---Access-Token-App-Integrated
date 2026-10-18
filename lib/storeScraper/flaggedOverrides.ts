// Client-safe (no "server-only") — this runs in the browser via
// localStorage, read and written from both the main store-scraper page's
// slider and the dedicated `/store-scraper-preview/[id]` grid page, so
// marking an image "actually fine, don't extract it" in either place is
// immediately reflected in the other and survives a reload.
//
// The key format `${sku}::${position}` matches `scanEntryKey` in
// `backgroundScanCache.ts` exactly (duplicated here rather than imported,
// since that module is server-only) — kept in sync deliberately so the
// override set lines up with the same identity the scan cache and export
// route use for each image.

const STORAGE_PREFIX = "store-scraper:flagged-overrides:";

export function overrideKey(sku: string, position: number): string {
  return `${sku}::${position}`;
}

/** Every image the user has explicitly said "this isn't actually a problem, keep it in the zip" for this job — persisted across reloads and shared between the main page's slider and the dedicated preview grid. */
export function loadKeptOverrides(jobId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + jobId);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function saveKeptOverrides(jobId: string, keys: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + jobId, JSON.stringify(Array.from(keys)));
  } catch {
    // Storage full or disabled — the override just won't persist across a
    // reload; it still works for the rest of this session either way.
  }
}
