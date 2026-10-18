import "server-only";
import type { ScrapedProduct, ScraperPlatform } from "./types";

/**
 * Per-product cache, keyed by platform + store origin + the same "ref" the
 * engine scrapes with (a Shopify handle, a WordPress product URL, a Magento
 * product id) — separate from the whole-job cache in `store.ts`.
 *
 * The whole-job cache is all-or-nothing: it only ever fires for a job that
 * finished with zero failures, and returns the ENTIRE prior result as-is.
 * This cache is what makes "Use cached results" actually useful for a job
 * that had some failures — re-running with the same URL skips re-fetching
 * every product that succeeded last time, while every product that failed
 * is deliberately never written here, so it always gets a fresh attempt
 * regardless of the cache setting. A cached failure would just be a cached
 * wrong answer.
 *
 * Stashed on `globalThis` for the same dev-HMR-survival reason as the job
 * registry in `store.ts` — see that file's own comment.
 */
const globalForProductCache = globalThis as unknown as { __storeScraperProductCache?: Map<string, ScrapedProduct> };
const cache = globalForProductCache.__storeScraperProductCache ?? new Map<string, ScrapedProduct>();
if (process.env.NODE_ENV !== "production") {
  globalForProductCache.__storeScraperProductCache = cache;
}

function cacheKey(platform: ScraperPlatform, origin: string, ref: string): string {
  return `${platform}::${origin}::${ref}`;
}

export function getCachedProduct(platform: ScraperPlatform, origin: string, ref: string): ScrapedProduct | null {
  return cache.get(cacheKey(platform, origin, ref)) ?? null;
}

export function setCachedProduct(platform: ScraperPlatform, origin: string, ref: string, product: ScrapedProduct): void {
  cache.set(cacheKey(platform, origin, ref), product);
}
