import { naturalCompare } from "@/lib/naturalSort";
import { normalizeSku, type StoreSkuEntry } from "@/lib/skuMatch";
import type { ScrapedProduct } from "@/lib/storeScraper/types";

export interface MatchedRow {
  sku: string;
  connected: StoreSkuEntry;
  scraped: ScrapedProduct;
  /** Several connected-store products carry this SKU — an update would be ambiguous, so it's never applied automatically. */
  shared: boolean;
}

export interface ConnectedOnlyRow {
  sku: string;
  connected: StoreSkuEntry;
}

export interface UrlOnlyRow {
  sku: string;
  scraped: ScrapedProduct;
}

export interface CompareResult {
  /** SKU found in both stores. */
  matched: MatchedRow[];
  /** SKU only in the connected store. */
  connectedOnly: ConnectedOnlyRow[];
  /** SKU only in the entered store — what "Add new products" would create. */
  urlOnly: UrlOnlyRow[];
  /** Entered-store products with no SKU at all: nothing to match on, so they're counted but never added. */
  urlNoSku: ScrapedProduct[];
}

const bySku = (a: { sku: string }, b: { sku: string }): number => naturalCompare(a.sku, b.sku);

/**
 * Matches the connected store's SKUs (variant SKU or a chosen metafield)
 * against the scraped store's SKUs. When a SKU repeats inside one store the
 * first occurrence represents it for preview/export purposes.
 */
export function compareStores(connected: StoreSkuEntry[], scraped: ScrapedProduct[], ignoreCase: boolean): CompareResult {
  const connectedByKey = new Map<string, StoreSkuEntry[]>();
  for (const entry of connected) {
    const key = normalizeSku(entry.sku, ignoreCase);
    if (!key) continue;
    const bucket = connectedByKey.get(key);
    if (bucket) bucket.push(entry);
    else connectedByKey.set(key, [entry]);
  }

  const scrapedByKey = new Map<string, ScrapedProduct>();
  const urlNoSku: ScrapedProduct[] = [];
  for (const product of scraped) {
    const key = normalizeSku(product.sku ?? "", ignoreCase);
    if (!key) {
      urlNoSku.push(product);
      continue;
    }
    if (!scrapedByKey.has(key)) scrapedByKey.set(key, product);
  }

  const matched: MatchedRow[] = [];
  const urlOnly: UrlOnlyRow[] = [];
  for (const [key, product] of scrapedByKey) {
    const entries = connectedByKey.get(key);
    if (entries) {
      matched.push({
        sku: entries[0].sku,
        connected: entries[0],
        scraped: product,
        shared: new Set(entries.map((e) => e.productId)).size > 1,
      });
    } else {
      urlOnly.push({ sku: (product.sku ?? "").trim(), scraped: product });
    }
  }

  const connectedOnly: ConnectedOnlyRow[] = [];
  for (const [key, entries] of connectedByKey) {
    if (!scrapedByKey.has(key)) connectedOnly.push({ sku: entries[0].sku, connected: entries[0] });
  }

  return {
    matched: matched.sort(bySku),
    connectedOnly: connectedOnly.sort(bySku),
    urlOnly: urlOnly.sort(bySku),
    urlNoSku,
  };
}
