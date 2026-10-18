/**
 * Resumable conversion progress, kept in IndexedDB — not `localStorage`,
 * because the whole point is storing the actual converted output images
 * (often hundreds of KB to a few MB each, thousands of them for a real
 * batch), which `localStorage`'s string-only, ~5-10MB-total quota can't
 * hold. IndexedDB survives a refresh AND a server restart exactly like
 * this tool's own conversion-settings `localStorage` does, for the same
 * reason: it's entirely local to this browser, tied to this origin, and
 * has nothing to do with the (nonexistent, for this tool) server side.
 *
 * Keyed by a file "signature" (see `zipSignature.ts`) rather than
 * anything server-issued, since this tool has no accounts or jobs to key
 * off of. Mirrors `bg-customiser/progressStore.ts` — same shape, separate
 * IndexedDB database, since the two tools' progress is unrelated.
 */

const DB_NAME = "mediaConverterProgress";
const DB_VERSION = 1;
const JOBS_STORE = "jobs";
const RESULTS_STORE = "results";

export interface JobMeta {
  signature: string;
  updatedAt: number;
  totalCount: number;
  doneCount: number;
}

interface StoredResult {
  id: string;
  signature: string;
  path: string;
  blob: Blob;
  filename: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(JOBS_STORE)) {
        db.createObjectStore(JOBS_STORE, { keyPath: "signature" });
      }
      if (!db.objectStoreNames.contains(RESULTS_STORE)) {
        const store = db.createObjectStore(RESULTS_STORE, { keyPath: "id" });
        store.createIndex("bySignature", "signature", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Couldn't open the progress database."));
  });
}

export async function getJobMeta(signature: string): Promise<JobMeta | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(JOBS_STORE, "readonly");
      const req = tx.objectStore(JOBS_STORE).get(signature);
      req.onsuccess = () => resolve((req.result as JobMeta | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Fire-and-forget from the caller's side — a failed progress write shouldn't hold up or fail the actual conversion run. */
export async function saveJobMeta(meta: JobMeta): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(JOBS_STORE, "readwrite");
      tx.objectStore(JOBS_STORE).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Storage unavailable / quota exceeded — this run's progress just won't be resumable.
  }
}

export async function saveResult(signature: string, path: string, filename: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RESULTS_STORE, "readwrite");
      const entry: StoredResult = { id: `${signature}::${path}`, signature, path, filename, blob };
      tx.objectStore(RESULTS_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Quota exceeded / storage unavailable — this one result just won't be resumable; the run itself keeps going.
  }
}

export interface SavedResult {
  filename: string;
  blob: Blob;
}

export async function loadSavedResults(signature: string): Promise<Map<string, SavedResult>> {
  const results = new Map<string, SavedResult>();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RESULTS_STORE, "readonly");
      const index = tx.objectStore(RESULTS_STORE).index("bySignature");
      const req = index.openCursor(IDBKeyRange.only(signature));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const value = cursor.value as StoredResult;
          results.set(value.path, { filename: value.filename, blob: value.blob });
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Nothing resumable — caller treats this the same as "no saved progress".
  }
  return results;
}

/** Removes a job's meta row and every one of its saved result blobs — called once a batch finishes and downloads successfully, so finished progress doesn't sit around taking up disk space forever. */
export async function clearJob(signature: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([JOBS_STORE, RESULTS_STORE], "readwrite");
      tx.objectStore(JOBS_STORE).delete(signature);
      const index = tx.objectStore(RESULTS_STORE).index("bySignature");
      const cursorReq = index.openCursor(IDBKeyRange.only(signature));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort cleanup — a failure here just leaves some stale data behind, not a correctness issue.
  }
}
