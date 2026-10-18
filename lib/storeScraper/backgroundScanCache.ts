import "server-only";
import { appendFile, mkdir, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface CachedScanEntry {
  sku: string;
  productName: string;
  /** 0-based, matches the position checkboxes in `ExcludeZipExport`. */
  position: number;
  url: string;
  isPlain: boolean;
}

/**
 * On-disk backing store for the scan cache — one append-only `.ndjson` file
 * per job under `<project>/data/store-scraper-scan-cache/`, same `data/`
 * directory and reasoning as `jobPersistence.ts`. This used to be
 * deliberately in-memory only ("a stale cache is worse than rescanning"),
 * but on a real store that's tens of thousands of images, a `next dev`
 * restart wiping out hours of already-checked images is a much bigger cost
 * than the (small, since results never actually go stale — a product's
 * photo doesn't change background type on its own) risk a stale entry
 * poses. One line per entry rather than one big JSON array so writing a
 * newly-finished image is a single append, not a rewrite of everything
 * scanned so far — the difference between O(1) and O(n) per image on a
 * batch of thousands.
 */
const DATA_DIR = path.join(process.cwd(), "data");
const SCAN_CACHE_DIR = path.join(DATA_DIR, "store-scraper-scan-cache");

function scanCacheFilePath(jobId: string): string {
  return path.join(SCAN_CACHE_DIR, `${jobId}.ndjson`);
}

const globalForScanCache = globalThis as unknown as {
  __storeScraperScanCache?: Map<string, Map<string, CachedScanEntry>>;
  __storeScraperScanCacheLoadedJobs?: Set<string>;
};
const scanCache = globalForScanCache.__storeScraperScanCache ?? new Map<string, Map<string, CachedScanEntry>>();
// Which job ids have already been hydrated from disk THIS process — so a
// job with thousands of persisted lines is only ever read back once, not
// on every single `getScanCacheEntries`/`setScanCacheEntry` call.
const loadedFromDisk = globalForScanCache.__storeScraperScanCacheLoadedJobs ?? new Set<string>();
if (process.env.NODE_ENV !== "production") {
  globalForScanCache.__storeScraperScanCache = scanCache;
  globalForScanCache.__storeScraperScanCacheLoadedJobs = loadedFromDisk;
}

function entriesFor(jobId: string): Map<string, CachedScanEntry> {
  let entries = scanCache.get(jobId);
  if (!entries) {
    entries = new Map();
    scanCache.set(jobId, entries);
  }
  return entries;
}

/** Reads this job's persisted lines back into memory, once per process. Synchronous — every call site here already needs the result immediately, and this only ever does real disk I/O once per job. */
function loadFromDiskIfNeeded(jobId: string): void {
  if (loadedFromDisk.has(jobId)) return;
  loadedFromDisk.add(jobId);
  const filePath = scanCacheFilePath(jobId);
  if (!existsSync(filePath)) return;
  const entries = entriesFor(jobId);
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const { key, entry } = JSON.parse(line) as { key: string; entry: CachedScanEntry };
      entries.set(key, entry);
    } catch {
      // A partial last line from a process that died mid-append — skip it,
      // everything before it is still intact.
    }
  }
}

let scanCacheDirEnsured = false;
async function ensureScanCacheDir(): Promise<void> {
  if (scanCacheDirEnsured) return;
  await mkdir(SCAN_CACHE_DIR, { recursive: true });
  scanCacheDirEnsured = true;
}

/** Best-effort — a failed disk write shouldn't take down the scan itself; the in-memory copy stays authoritative for the rest of this process's life either way. */
async function persistScanEntry(jobId: string, key: string, entry: CachedScanEntry): Promise<void> {
  try {
    await ensureScanCacheDir();
    await appendFile(scanCacheFilePath(jobId), `${JSON.stringify({ key, entry })}\n`, "utf8");
  } catch {
    // best-effort, see doc comment
  }
}

async function deletePersistedScanCache(jobId: string): Promise<void> {
  try {
    await unlink(scanCacheFilePath(jobId));
  } catch {
    // best-effort — already gone, or never existed
  }
}

export function scanEntryKey(sku: string, position: number): string {
  return `${sku}::${position}`;
}

/** Every image already scanned for this job so far — empty (not missing) for a job that's never been scanned. */
export function getScanCacheEntries(jobId: string): Map<string, CachedScanEntry> {
  loadFromDiskIfNeeded(jobId);
  return scanCache.get(jobId) ?? new Map();
}

/** Writes ONE image's result immediately, rather than batching until the whole scan finishes — a cancel mid-scan (or the whole server restarting) still keeps every entry written up to that point. */
export function setScanCacheEntry(jobId: string, key: string, entry: CachedScanEntry): void {
  loadFromDiskIfNeeded(jobId);
  entriesFor(jobId).set(key, entry);
  void persistScanEntry(jobId, key, entry);
}

/**
 * Invalidates only specific images' cached results — for the common case
 * where a re-save touched a known, small subset of files (whatever
 * `saveMediaToUploads` actually (re)wrote; everything skip-if-exists stays
 * untouched). Only removed from the in-memory Map, not the on-disk NDJSON
 * file: a later re-scan naturally appends a fresh line for the same key,
 * and `loadFromDiskIfNeeded`'s line-by-line `.set()` already makes a later
 * line for a key win over an earlier one, so the stale line becomes
 * harmless without needing to rewrite the file to remove it.
 */
export function clearScanCacheEntries(jobId: string, keys: string[]): void {
  const entries = scanCache.get(jobId);
  if (!entries) return;
  for (const key of keys) entries.delete(key);
}

/** Called when the user explicitly asks for a full rescan (`?rescan=1`) — every cached result for this job is thrown out, disk file included. For a targeted invalidation (e.g. after a re-save that only touched a few files), use `clearScanCacheEntries` instead — clearing the whole job here for a handful of changed files would throw out far more already-correct work than it protects. */
export function clearScanCache(jobId: string): void {
  scanCache.delete(jobId);
  // So a later re-scan for this same job doesn't hydrate the stale file
  // back in before this run has written its own fresh entries over it.
  loadedFromDisk.delete(jobId);
  void deletePersistedScanCache(jobId);
}
