import "server-only";
import { randomUUID } from "node:crypto";
import { AsyncQueue, drainWithConcurrency } from "./asyncQueue";
import { createJob, updateJob, appendProduct, appendFailure, findCachedJob, getJob, persistJobSnapshot } from "./store";
import { getCachedProduct, setCachedProduct } from "./productCache";
import { requestCancel, isCancelRequested, clearCancelFlag } from "./cancellation";
import { discoverShopifyHandles, scrapeShopifyProduct, type ShopifyProduct } from "./engines/shopify";
import { discoverWordPressProductUrls, scrapeWordPressProduct } from "./engines/wordpress";
import { discoverMagentoProducts, assembleMagentoProduct, type MagentoProductNode } from "./engines/magento";
import type { ScrapedProduct, ScrapeJob, ScrapeJobOptions } from "./types";

/** How often an in-progress job's current state gets flushed to disk (see `store.ts`'s `persistJobSnapshot`) — so a server restart mid-scrape loses at most this much progress instead of everything since the job started. */
const PERSIST_SNAPSHOT_INTERVAL_MS = 5_000;

/** Requests that a running job stop — cooperative, not immediate: in-flight discovery pages/scrapes finish normally, but no new ones start. Called from the cancel API route. */
export function cancelJob(jobId: string): void {
  requestCancel(jobId);
}

const CONCURRENCY: Record<ScrapeJobOptions["platform"], number> = {
  // Shopify costs 2 requests/product (JSON + HTML). The per-origin request
  // PACE in http.ts (now adaptive — see its own comment) is what actually
  // protects a store from being hammered; concurrency here just controls
  // how many requests can be AWAITING a response at once, letting the
  // adaptive pace's higher ceiling (up to ~22 req/sec) actually get used
  // instead of being starved by too few workers in flight.
  shopify: 8,
  wordpress: 6,
  magento: 10,
};

function newJob(options: ScrapeJobOptions): ScrapeJob {
  return {
    id: randomUUID(),
    options,
    status: "queued",
    statusMessage: "Queued…",
    totalDiscovered: 0,
    scrapedCount: 0,
    failedCount: 0,
    failures: [],
    products: [],
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}

/**
 * Creates (or reuses a cached) job and returns it immediately — the actual
 * scrape is started separately via `runScrapeJob`, scheduled with Next.js's
 * `after()` from the calling route handler. Splitting creation from
 * execution like this (rather than an un-awaited `void runJob()` fired from
 * inside this function) is deliberate: a bare fire-and-forget promise has
 * no guarantee it survives past the response being sent on every runtime
 * Next.js can target, whereas `after()` is the framework's own supported
 * primitive for exactly this "keep running after the response" case.
 */
export function startJob(options: ScrapeJobOptions): ScrapeJob {
  if (options.useCache) {
    const cached = findCachedJob(options);
    if (cached) return cached;
  }

  const job = newJob(options);
  createJob(job);
  return job;
}

export async function runScrapeJob(jobId: string): Promise<void> {
  try {
    await runJob(jobId);
  } catch (err) {
    updateJob(jobId, {
      status: "error",
      statusMessage: "Failed.",
      error: err instanceof Error ? err.message : "Something went wrong.",
      finishedAt: new Date().toISOString(),
    });
  }
}

/**
 * Runs one platform's discover→scrape pipeline and finalizes the job.
 *
 * The discovery and scraping sides are awaited with `Promise.allSettled`,
 * not `Promise.all` — this is the fix for a real bug: `Promise.all` rejects
 * (and `runJob` returns) the instant discovery throws, WITHOUT waiting for
 * the scrape workers that are still draining already-discovered items from
 * the queue. Those workers kept running in the background afterward
 * (nothing was cancelling them), silently mutating a job that had already
 * been marked "error" and "finished" — so the client stopped polling and
 * never saw results that were, in fact, still coming in. A discovery
 * failure after finding thousands of products (e.g. one page 429ing after
 * retries) shouldn't erase everything already found and being scraped.
 */
async function runPipeline<TRef>(
  jobId: string,
  options: ScrapeJobOptions,
  concurrency: number,
  discover: (push: (ref: TRef) => void, onProgress: (n: number) => void, shouldStop?: () => boolean) => Promise<void>,
  scrapeOne: (ref: TRef) => Promise<void>,
): Promise<void> {
  const queue = new AsyncQueue<TRef>();
  const shouldStop = () => isCancelRequested(jobId);

  // Persists the job's current (in-progress) state to disk on a timer —
  // `updateJob` only writes to disk once a job FINISHES, so without this a
  // server restart mid-scrape would lose everything found so far, not
  // just whatever's still in flight.
  const snapshotTimer = setInterval(() => persistJobSnapshot(jobId), PERSIST_SNAPSHOT_INTERVAL_MS);

  try {
    const discovery = discover(
      (ref) => queue.push(ref),
      (n) => updateJob(jobId, { totalDiscovered: n }),
      shouldStop,
    ).finally(() => queue.close());

    updateJob(jobId, { status: "scraping", statusMessage: "Scraping products…" });

    const scraping = drainWithConcurrency(queue, concurrency, (ref) => scrapeOne(ref), shouldStop);

    const [discoveryResult] = await Promise.allSettled([discovery, scraping]);

    const finished = await getJob(jobId);
    const scrapedCount = finished?.products.length ?? 0;
    const failedCount = finished?.failures.length ?? 0;

    if (shouldStop()) {
      updateJob(jobId, {
        status: "cancelled",
        statusMessage: `Cancelled — ${scrapedCount} scraped, ${failedCount} failed before stopping.`,
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    if (discoveryResult.status === "rejected") {
      const message = discoveryResult.reason instanceof Error ? discoveryResult.reason.message : "Couldn't finish finding all products.";
      if (scrapedCount === 0 && failedCount === 0) {
        // Nothing was ever found or scraped — this really is a hard failure.
        updateJob(jobId, {
          status: "error",
          statusMessage: "Failed.",
          error: message,
          finishedAt: new Date().toISOString(),
        });
        return;
      }
      // Partial results exist — surface the discovery problem as a note, but
      // still hand back everything that WAS found and scraped rather than
      // discarding it.
      updateJob(jobId, {
        status: "done",
        statusMessage: `Done (discovery stopped early) — ${scrapedCount} scraped, ${failedCount} failed.`,
        error: `Stopped finding more products early: ${message}`,
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    updateJob(jobId, {
      status: "done",
      statusMessage: `Done — ${scrapedCount} scraped, ${failedCount} failed.`,
      finishedAt: new Date().toISOString(),
    });
  } finally {
    clearInterval(snapshotTimer);
    clearCancelFlag(jobId);
  }
}

/**
 * Wraps a single product's scrape with the per-product cache (see
 * `productCache.ts`): a cache hit is appended instantly with no network
 * work at all, a successful fresh scrape gets written to the cache for
 * next time, and a failure is NEVER cached — so re-running with "use
 * cached results" on always re-attempts whatever failed last time, while
 * skipping everything that already succeeded.
 */
async function scrapeWithCache(
  jobId: string,
  options: ScrapeJobOptions,
  origin: string,
  refKey: string,
  scrape: () => Promise<ScrapedProduct>,
): Promise<void> {
  if (options.useCache) {
    const cached = getCachedProduct(options.platform, origin, refKey);
    if (cached) {
      appendProduct(jobId, cached);
      return;
    }
  }
  try {
    const product = await scrape();
    appendProduct(jobId, product);
    setCachedProduct(options.platform, origin, refKey, product);
  } catch (err) {
    appendFailure(jobId, { input: refKey, error: err instanceof Error ? err.message : "Failed to scrape." });
  }
}

async function runJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  const { options } = job;
  const origin = new URL(options.inputUrl).origin;

  updateJob(jobId, { status: "discovering", statusMessage: "Finding products…" });

  if (options.platform === "shopify") {
    await runPipeline(jobId, options, CONCURRENCY.shopify, discoverShopifyHandles.bind(null, options), (product: ShopifyProduct) =>
      scrapeWithCache(jobId, options, origin, product.handle, () => scrapeShopifyProduct(product, options)),
    );
  } else if (options.platform === "wordpress") {
    await runPipeline(jobId, options, CONCURRENCY.wordpress, discoverWordPressProductUrls.bind(null, options), (url: string) =>
      scrapeWithCache(jobId, options, origin, url, () => scrapeWordPressProduct(url, options)),
    );
  } else {
    await runPipeline(jobId, options, CONCURRENCY.magento, discoverMagentoProducts.bind(null, options), (node: MagentoProductNode) =>
      scrapeWithCache(jobId, options, origin, node.sku || String(node.id), () => assembleMagentoProduct(node, options)),
    );
  }
}
