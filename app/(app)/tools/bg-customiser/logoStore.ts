/**
 * Remembers the logo image between visits. The logo's position, size and margin already survive a refresh in
 * `localStorage` (see persistedSettings.ts), but a picture can't be stored as JSON — so the image file itself is kept
 * in IndexedDB, in this browser only. One logo at a time: saving a new one replaces the old.
 * Browser-only: every function needs `indexedDB`.
 */

const DB_NAME = "bg-customiser-logo";
const STORE = "logo";
const KEY = "current";

interface SavedLogo {
  blob: Blob;
  name: string;
  type: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("No IndexedDB in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Couldn't open the logo storage."));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error("Logo storage failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Logo storage was blocked."));
    });
  } finally {
    db.close();
  }
}

/** Keeps this logo for next time. Resolves false (never throws) when the browser won't store it, e.g. private browsing. */
export async function saveLogo(file: File): Promise<boolean> {
  try {
    const saved: SavedLogo = { blob: file, name: file.name, type: file.type };
    await run("readwrite", (store) => store.put(saved, KEY));
    return true;
  } catch {
    return false;
  }
}

/** The logo from the last visit as a File, or null when there is none (or storage isn't available). */
export async function loadSavedLogo(): Promise<File | null> {
  try {
    const saved = await run<SavedLogo | undefined>("readonly", (store) => store.get(KEY));
    if (!saved?.blob) return null;
    return new File([saved.blob], saved.name, { type: saved.type || saved.blob.type });
  } catch {
    return null;
  }
}

export async function clearSavedLogo(): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(KEY));
  } catch {
    // Nothing stored, or storage unavailable — either way there's nothing left to forget.
  }
}
