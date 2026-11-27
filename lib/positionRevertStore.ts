/**
 * Revert points for "Upload media by positions". Replacing an image keeps its address, so the old picture is gone from
 * Shopify the moment it's replaced — the only way back is to keep our own copy of the old file first. Those copies live
 * in this browser's IndexedDB (files are too big for localStorage), grouped into one batch per upload run.
 * Browser-only: every function here needs `indexedDB`.
 */

const DB_NAME = "position-media-reverts";
const DB_VERSION = 1;
const BATCHES = "batches";
const ENTRIES = "entries";

export interface RevertBatchInfo {
  id: string;
  createdAt: number;
  label: string;
  revertedAt: number | null;
}

export interface RevertEntry {
  /** `${batchId}:${mediaId}` — one copy per replaced image. */
  key: string;
  batchId: string;
  productId: string;
  sku: string;
  title: string;
  /** Where the image sat when it was replaced — shown for context only; the revert targets the image itself, not the slot. */
  position: number;
  mediaId: string;
  filename: string;
  mimeType: string;
  /** The picture as it was before the replacement. */
  blob: Blob;
  /** true = replaced, false = the replacement failed (nothing to undo), null = unknown (the page closed mid-run, so it may have been replaced). */
  applied: boolean | null;
}

export interface RevertBatchSummary extends RevertBatchInfo {
  /** Images that a revert would put back (applied or unknown). */
  restorable: number;
  bytes: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser can't keep revert copies (no IndexedDB)."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(BATCHES, { keyPath: "id" });
      db.createObjectStore(ENTRIES, { keyPath: "key" }).createIndex("batchId", "batchId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Couldn't open the revert storage."));
  });
}

const wrap = <T,>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Revert storage failed."));
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Revert storage failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Revert storage was blocked — the browser may be out of space."));
  });

export async function createBatch(label: string): Promise<RevertBatchInfo> {
  const batch: RevertBatchInfo = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), label, revertedAt: null };
  const db = await openDb();
  const tx = db.transaction(BATCHES, "readwrite");
  tx.objectStore(BATCHES).put(batch);
  await done(tx);
  db.close();
  return batch;
}

export async function saveEntry(entry: RevertEntry): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ENTRIES, "readwrite");
  tx.objectStore(ENTRIES).put(entry);
  await done(tx);
  db.close();
}

/** Records how the replacement went, so a revert only touches images that were really replaced. */
export async function setApplied(batchId: string, mediaId: string, applied: boolean): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ENTRIES, "readwrite");
  const store = tx.objectStore(ENTRIES);
  const existing = (await wrap(store.get(`${batchId}:${mediaId}`))) as RevertEntry | undefined;
  if (existing) store.put({ ...existing, applied });
  await done(tx);
  db.close();
}

export async function listBatches(): Promise<RevertBatchSummary[]> {
  const db = await openDb();
  const tx = db.transaction([BATCHES, ENTRIES], "readonly");
  const batches = (await wrap(tx.objectStore(BATCHES).getAll())) as RevertBatchInfo[];
  const totals = new Map<string, { restorable: number; bytes: number }>();
  await new Promise<void>((resolve, reject) => {
    const cursor = tx.objectStore(ENTRIES).openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        resolve();
        return;
      }
      const entry = current.value as RevertEntry;
      const total = totals.get(entry.batchId) ?? { restorable: 0, bytes: 0 };
      if (entry.applied !== false) total.restorable += 1;
      total.bytes += entry.blob.size;
      totals.set(entry.batchId, total);
      current.continue();
    };
    cursor.onerror = () => reject(cursor.error ?? new Error("Revert storage failed."));
  });
  db.close();
  return batches
    .map((b) => ({ ...b, restorable: totals.get(b.id)?.restorable ?? 0, bytes: totals.get(b.id)?.bytes ?? 0 }))
    .filter((b) => b.restorable > 0 || b.bytes > 0)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getEntries(batchId: string): Promise<RevertEntry[]> {
  const db = await openDb();
  const entries = (await wrap(db.transaction(ENTRIES, "readonly").objectStore(ENTRIES).index("batchId").getAll(batchId))) as RevertEntry[];
  db.close();
  return entries;
}

export async function markReverted(batchId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(BATCHES, "readwrite");
  const store = tx.objectStore(BATCHES);
  const existing = (await wrap(store.get(batchId))) as RevertBatchInfo | undefined;
  if (existing) store.put({ ...existing, revertedAt: Date.now() });
  await done(tx);
  db.close();
}

export async function deleteBatch(batchId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([BATCHES, ENTRIES], "readwrite");
  tx.objectStore(BATCHES).delete(batchId);
  const entries = tx.objectStore(ENTRIES);
  const keys = (await wrap(entries.index("batchId").getAllKeys(batchId))) as IDBValidKey[];
  for (const key of keys) entries.delete(key);
  await done(tx);
  db.close();
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };

/** A file name for a saved copy, with an extension that matches what the bytes really are. */
export const backupFilename = (mediaId: string, mimeType: string): string => `${mediaId.split("/").pop()}.${EXTENSIONS[mimeType] ?? "jpg"}`;

/** Downloads the image behind a Shopify CDN address. Throws on any failure — a revert point that can't be saved must stop the replacement. */
export async function fetchImageBlob(url: string, signal?: AbortSignal): Promise<{ blob: Blob; mimeType: string }> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`The current image couldn't be downloaded (${response.status}).`);
  const blob = await response.blob();
  const mimeType = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  if (blob.size === 0) throw new Error("The current image downloaded empty.");
  return { blob, mimeType };
}
