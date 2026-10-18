import "server-only";
import { safeFetchBinary } from "@/lib/seoAudit/safeFetch";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ZipStreamWriter } from "./zipStream";
import { isPlainBackgroundImage } from "./plainBackground";
import { setExportProgress, clearExportProgress } from "./exportProgress";
import { getCachedImage, setCachedImage } from "./imageCache";
import type { ScrapedProduct } from "./types";

// Products (not raw images) are the concurrency unit here — each product
// task downloads its own handful of images with `Promise.all` (typically
// 4-8), so overall concurrent image fetches land around
// PRODUCT_CONCURRENCY × avg images/product, comfortably higher than the
// old flat 16-image limit, while still keeping each product's own image
// set together so it can be written out as one finished unit — see
// `streamMediaZip`'s own doc comment for why that grouping matters.
const PRODUCT_CONCURRENCY = 10;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;
const IMAGE_FETCH_ATTEMPTS = 2;
// `safeFetch`'s own default cap (5MB) is sized for arbitrary HTML pages, not
// real product photography — see the same constant in `mediaUpload.ts`.
const IMAGE_FETCH_MAX_BYTES = 50 * 1024 * 1024; // 50MB

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product"
  );
}

function extensionFor(url: string): string {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.([a-zA-Z0-9]{2,5})$/);
    return match ? match[1].toLowerCase() : "jpg";
  } catch {
    return "jpg";
  }
}

interface FetchedImage {
  originalPosition: number;
  ext: string;
  bytes: Uint8Array;
}

/**
 * Downloads a single image, going through the on-disk cache first — a hit
 * skips the network entirely (see `imageCache.ts`); a miss fetches fresh
 * and writes the result to the cache (fire-and-forget — a failed cache
 * write shouldn't hold up or fail the export itself) so the NEXT export of
 * this same image, whatever exclude combination it asks for, is a cache
 * hit instead of a re-download.
 */
async function fetchImageBytes(url: string, allowInsecureTls: boolean): Promise<Uint8Array> {
  const cached = await getCachedImage(url);
  if (cached) return cached;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= IMAGE_FETCH_ATTEMPTS; attempt++) {
    try {
      const result = await safeFetchBinary(url, { allowInsecureTls, timeoutMs: IMAGE_FETCH_TIMEOUT_MS, maxBytes: IMAGE_FETCH_MAX_BYTES });
      const bytes = new Uint8Array(result.bytes);
      void setCachedImage(url, bytes);
      return bytes;
    } catch (err) {
      lastErr = err;
      if (attempt < IMAGE_FETCH_ATTEMPTS) await sleep(300);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("failed");
}

/**
 * Downloads a single product's images (concurrently, since a product only
 * has a handful) and returns whichever ones survived — fetch failures and
 * confirmed-plain-background exclusions both drop out here, with failures
 * appended to `failures` for the `_failed-downloads.txt` manifest.
 */
async function fetchProductImages(
  product: ScrapedProduct,
  slug: string,
  allowInsecureTls: boolean,
  excludeImagePositions: Set<number> | undefined,
  failures: string[],
): Promise<FetchedImage[]> {
  const results = await Promise.all(
    product.images.map(async (url, index): Promise<FetchedImage | null> => {
      const originalPosition = index + 1;
      const isExclusionCandidate = excludeImagePositions?.has(originalPosition) ?? false;
      try {
        const bytes = await fetchImageBytes(url, allowInsecureTls);
        if (isExclusionCandidate && (await isPlainBackgroundImage(Buffer.from(bytes)))) {
          return null; // confirmed plain background at a marked position — drop it
        }
        return { originalPosition, ext: extensionFor(url), bytes };
      } catch (err) {
        failures.push(`${slug} position ${originalPosition} <- ${url}: ${err instanceof Error ? err.message : "failed"}`);
        return null;
      }
    }),
  );
  return results.filter((r): r is FetchedImage => r !== null);
}

/**
 * Streams a ZIP of every scraped product's images as a `ReadableStream`,
 * instead of building the whole archive in memory before returning
 * anything — laid out `<sku-or-handle>/image-N.ext` per product, same as
 * before. The route handler pipes this straight into the HTTP response,
 * so the browser's download starts the moment the FIRST product's images
 * are ready, not once every single image across the whole store has been
 * fetched — for a store with thousands of images, that used to mean
 * sitting on a spinner for the entire export before a single byte moved;
 * now bytes start flowing almost immediately and keep flowing as more
 * products finish.
 *
 * Products (not a flat image list) are the streaming unit: each product's
 * images are downloaded together and written to the zip together, in
 * order, the moment that PRODUCT is fully resolved — whichever product
 * finishes first streams first, but a product's own `image-1, image-2,
 * ...` ordering is still exact. `excludeImagePositions` and the
 * plain-background check work exactly as before (see `isPlainBackgroundImage`).
 *
 * Every image is written as a STORED (uncompressed) zip entry rather than
 * deflated — see `zipStream.ts`'s own note on why recompressing
 * already-compressed image bytes is wasted work.
 */
export function streamMediaZip(
  jobId: string,
  products: ScrapedProduct[],
  allowInsecureTls: boolean,
  excludeImagePositions?: Set<number>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Set when the browser disconnects mid-download (a refresh, a closed
  // tab, a dropped connection) — checked before starting each NEW
  // product's downloads, so an abandoned export stops picking up more
  // work instead of quietly churning through the rest of a 3000+ product
  // catalog for a response nobody is reading anymore. In-flight work for
  // the product(s) already started still finishes normally rather than
  // being torn out mid-request.
  let stopped = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer = new ZipStreamWriter();
      const usedSlugs = new Map<string, number>();
      const failures: string[] = [];
      let productsDone = 0;
      setExportProgress(jobId, 0, products.length);

      try {
        await mapWithConcurrency(products, PRODUCT_CONCURRENCY, async (product) => {
          if (stopped) return;
          const baseSlug = slugify(product.sku || product.name || product.productId);
          const count = usedSlugs.get(baseSlug) ?? 0;
          usedSlugs.set(baseSlug, count + 1);
          const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;

          const kept = await fetchProductImages(product, slug, allowInsecureTls, excludeImagePositions, failures);
          if (stopped) return; // the connection dropped while this product's images were downloading — don't bother enqueueing into a closed stream
          kept.sort((a, b) => a.originalPosition - b.originalPosition);
          kept.forEach((item, index) => {
            controller.enqueue(writer.addEntry(`${slug}/image-${index + 1}.${item.ext}`, item.bytes));
          });

          productsDone += 1;
          setExportProgress(jobId, productsDone, products.length);
        });

        if (stopped) return;

        if (failures.length > 0) {
          controller.enqueue(writer.addEntry("_failed-downloads.txt", encoder.encode(failures.join("\n"))));
        }

        controller.enqueue(writer.finish());
        controller.close();
      } catch (err) {
        if (!stopped) controller.error(err);
      } finally {
        clearExportProgress(jobId);
      }
    },
    cancel() {
      // Called by the platform when the consumer (the HTTP response) goes
      // away before the stream finished — exactly the refresh/dropped
      // connection case this whole flag exists for.
      stopped = true;
    },
  });
}
