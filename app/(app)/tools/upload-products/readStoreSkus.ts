import type { StoreSkuEntry } from "@/lib/skuMatch";
import { loadStoreSkuPageAction, type StoreSkuSource } from "./actions";

/** Safety stop for the page-by-page store read (2,000 pages ≈ 500k variants) so a broken cursor can never loop forever. */
const MAX_STORE_PAGES = 2000;

export interface StoreReadProgress {
  /** Variants (or products, for a metafield source) read so far. */
  read: number;
  /** The store's own count, when Shopify gave one — null otherwise. */
  total: number | null;
}

export type StoreReadResult = { ok: true; entries: StoreSkuEntry[] } | { ok: false; error: string };

/**
 * Reads every SKU value the connected store has for the chosen field, one
 * page at a time, reporting progress after each page so a caller can show
 * live "read X of Y" counts instead of one long silent wait.
 */
export async function readStoreSkuIndex(
  source: StoreSkuSource,
  onProgress: (progress: StoreReadProgress) => void,
  shouldCancel: () => boolean,
): Promise<StoreReadResult> {
  const entries: StoreSkuEntry[] = [];
  let read = 0;
  let total: number | null = null;
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < MAX_STORE_PAGES; pageNumber++) {
    if (shouldCancel()) return { ok: false, error: "Cancelled." };
    const page = await loadStoreSkuPageAction(source, cursor);
    if (!page.ok) return { ok: false, error: page.error };
    if (page.total !== null) total = page.total;
    read += page.scanned;
    entries.push(...page.entries);
    onProgress({ read, total });
    if (!page.nextCursor) return { ok: true, entries };
    cursor = page.nextCursor;
  }
  return { ok: false, error: "The store has more products than this tool can read in one go." };
}
