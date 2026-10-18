const HISTORY_KEY = "media-upload:last-upload-ids";

type History = Record<string, string[]>;

function readHistory(): History {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as History) : {};
  } catch {
    return {};
  }
}

function writeHistory(history: History): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // storage full or disabled — history just won't persist
  }
}

/** Media IDs this tool uploaded to a product the last time it ran, if any — lets "replace my last upload" target only those instead of every image on the product. */
export function getLastUploadedMediaIds(productId: string): string[] {
  return readHistory()[productId] ?? [];
}

export function setLastUploadedMediaIds(productId: string, mediaIds: string[]): void {
  const history = readHistory();
  if (mediaIds.length === 0) {
    delete history[productId];
  } else {
    history[productId] = mediaIds;
  }
  writeHistory(history);
}
