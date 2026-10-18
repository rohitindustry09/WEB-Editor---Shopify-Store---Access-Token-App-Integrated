/**
 * Remembers which products already got their images from a given zip, in this
 * browser, so an upload that was stopped (or lost to a page reload / server
 * restart) can be resumed. Keyed by the zip's name + size + last-modified, so
 * picking the same file again finds its progress. The zip itself can't be
 * kept — a browser forgets a chosen file on reload — so the page still needs it
 * re-added and scanned; this is what lets it carry on from where it stopped.
 */
const STORAGE_KEY = "media-upload-progress-v1";
const MAX_REMEMBERED_ZIPS = 5;
const FLUSH_DELAY_MS = 400;

type Stored = Record<string, { ids: string[]; at: number }>;

export function zipProgressKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function readAll(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Stored): void {
  try {
    // Keep only the most recent zips so storage can't grow without bound.
    const newest = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_REMEMBERED_ZIPS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // storage full or blocked — progress just won't survive a reload
  }
}

/** Product ids (numeric part of the gid) already uploaded for this zip. */
export function loadUploadedIds(key: string): Set<string> {
  return new Set(readAll()[key]?.ids ?? []);
}

const shortId = (productId: string): string => productId.split("/").pop() ?? productId;
export const productIdMatches = (productId: string, stored: ReadonlySet<string>): boolean => stored.has(shortId(productId));

const pending = new Map<string, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  flushTimer = null;
  const all = readAll();
  for (const [key, ids] of pending) {
    const merged = new Set(all[key]?.ids ?? []);
    for (const id of ids) merged.add(id);
    all[key] = { ids: [...merged], at: Date.now() };
  }
  pending.clear();
  writeAll(all);
}

/** Records one finished product. Writes are batched, so thousands of products don't mean thousands of storage writes. */
export function recordUploaded(key: string, productId: string): void {
  const ids = pending.get(key) ?? new Set<string>();
  ids.add(shortId(productId));
  pending.set(key, ids);
  if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

/** Forgets this zip's progress ("start over"). */
export function clearUploadedIds(key: string): void {
  pending.delete(key);
  const all = readAll();
  delete all[key];
  writeAll(all);
}

// A write still waiting on the batching delay must not be lost when the tab is closed or reloaded.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (pending.size > 0) flush();
  });
}
