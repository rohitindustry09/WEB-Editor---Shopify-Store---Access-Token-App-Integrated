import type { ScrapeJobSummary, ScrapedProduct } from "@/lib/storeScraper/types";

const POLL_INTERVAL_MS = 1000;
const PRODUCTS_PAGE_SIZE = 500;

export interface ScrapeProgress {
  scraped: number;
  total: number;
  message: string;
}

export type ScrapeOutcome = { ok: true; products: ScrapedProduct[]; hostname: string } | { ok: false; error: string };

/** Accepts "store.com", "www.store.com/", or a full URL and returns a clean https URL, or null if it isn't one. */
export function normalizeStoreUrl(input: string): { url: string; hostname: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!parsed.hostname.includes(".")) return null;
    return { url: parsed.origin, hostname: parsed.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJob(jobId: string, page: number, pageSize: number): Promise<{ job: ScrapeJobSummary; products: ScrapedProduct[] }> {
  const res = await fetch(`/api/store-scraper/jobs/${jobId}?page=${page}&pageSize=${pageSize}`);
  if (!res.ok) throw new Error("Couldn't read the scrape job.");
  return (await res.json()) as { job: ScrapeJobSummary; products: ScrapedProduct[] };
}

/**
 * Reads every product of a Shopify store through the existing Store scraper
 * job system, in its quick read-only mode (name, SKU, price, images and
 * descriptions straight from the store's catalog data — no per-product page
 * visits). Nothing is saved to or changed in either store.
 */
export async function scrapeShopifyStore(
  inputUrl: string,
  fresh: boolean,
  onProgress: (progress: ScrapeProgress) => void,
  shouldCancel: () => boolean,
): Promise<ScrapeOutcome> {
  const normalized = normalizeStoreUrl(inputUrl);
  if (!normalized) return { ok: false, error: "That doesn't look like a store address — try something like example-store.com." };

  try {
    const startRes = await fetch("/api/store-scraper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "shopify",
        scope: "store",
        inputUrl: normalized.url,
        requestedFields: "",
        containerClasses: "",
        useCache: !fresh,
        allowInsecureTls: false,
        quickMediaMode: true,
      }),
    });
    const started = (await startRes.json()) as { job?: ScrapeJobSummary; error?: string };
    if (!startRes.ok || !started.job) return { ok: false, error: started.error ?? "Couldn't start reading that store." };

    const jobId = started.job.id;
    let job = started.job;
    while (job.status === "queued" || job.status === "discovering" || job.status === "scraping") {
      if (shouldCancel()) {
        await fetch(`/api/store-scraper/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => undefined);
        return { ok: false, error: "Cancelled." };
      }
      onProgress({ scraped: job.scrapedCount, total: job.totalDiscovered, message: job.statusMessage });
      await sleep(POLL_INTERVAL_MS);
      job = (await readJob(jobId, 1, 1)).job;
    }

    if (job.status === "error") return { ok: false, error: job.error ?? "Reading that store failed." };
    if (job.status === "cancelled") return { ok: false, error: "Cancelled." };

    const products: ScrapedProduct[] = [];
    for (let page = 1; products.length < job.productCount; page++) {
      const batch = await readJob(jobId, page, PRODUCTS_PAGE_SIZE);
      if (batch.products.length === 0) break;
      products.push(...batch.products);
      onProgress({ scraped: products.length, total: job.productCount, message: "Loading products…" });
    }
    return { ok: true, products, hostname: normalized.hostname };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't read that store." };
  }
}
