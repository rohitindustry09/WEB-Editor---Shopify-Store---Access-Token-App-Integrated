import "server-only";
import * as cheerio from "cheerio";
import { fetchJson, fetchHtml, HttpStatusError } from "../http";
import { extractCustomFields } from "../customFields";
import type { ScrapeJobOptions, ScrapedProduct } from "../types";

const MAX_ARCHIVE_PAGES = 200;
const REST_PAGE_SIZE = 100;

const ARCHIVE_PRODUCT_LINK_SELECTORS = [
  "ul.products li.product a.woocommerce-LoopProduct-link",
  "ul.products li.product > a",
  "ul.products li.product a.woocommerce-loop-product__link",
  ".products .product a[href]",
];

const ARCHIVE_NEXT_PAGE_SELECTORS = [
  "a.next.page-numbers",
  ".woocommerce-pagination a.next",
  "nav.pagination a.next",
  "a[rel='next']",
];

const PRODUCT_TITLE_SELECTORS = ["h1.product_title", ".product_title", "h1"];
const PRODUCT_SALE_PRICE_SELECTORS = [".summary .price ins .amount bdi", ".summary .price ins .amount", ".product .price ins .amount"];
const PRODUCT_REGULAR_PRICE_SELECTORS = [
  ".summary .price del .amount bdi",
  ".summary .price del .amount",
  ".summary .price .amount bdi",
  ".summary .price .amount",
  ".product .price .amount",
];
const PRODUCT_IMAGE_SELECTORS = [
  ".woocommerce-product-gallery__image img",
  "figure.woocommerce-product-gallery__wrapper img",
  ".images img",
];
const PRODUCT_SKU_SELECTORS = [".sku"];
const PRODUCT_CATEGORY_SELECTORS = [".posted_in a", ".product_meta .posted_in a"];
const PRODUCT_TAG_SELECTORS = [".tagged_as a", ".product_meta .tagged_as a"];
const PRODUCT_DESCRIPTION_SELECTORS = ["#tab-description", ".woocommerce-product-details__short-description", ".product-description"];

function baseUrlFor(options: ScrapeJobOptions): string {
  return new URL(options.inputUrl).origin;
}

function parseMoney(text: string | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.,]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  const value = Number(cleaned.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function firstText($: cheerio.CheerioAPI, selectors: string[]): string | null {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) return text;
  }
  return null;
}

function firstMatch($: cheerio.CheerioAPI, selectors: string[]) {
  for (const selector of selectors) {
    const el = $(selector).first();
    if (el.length > 0) return el;
  }
  return null;
}

/**
 * Returns `true` and pushes every found product URL as each REST page
 * arrives, or `false` (having pushed nothing) when this install doesn't
 * expose a `product` post type over REST at all — the common case, since
 * WooCommerce doesn't register that route by default. Only page 1 failing
 * triggers the "doesn't exist" fallback; a later page failing keeps
 * whatever was already pushed rather than discarding it.
 */
async function discoverViaRest(
  origin: string,
  options: ScrapeJobOptions,
  push: (url: string) => void,
  onProgress: (n: number) => void,
  shouldStop?: () => boolean,
): Promise<boolean> {
  let discovered = 0;
  for (let page = 1; page <= MAX_ARCHIVE_PAGES; page++) {
    if (shouldStop?.()) break;
    let data: { link?: string }[];
    try {
      data = await fetchJson<{ link?: string }[]>(`${origin}/wp-json/wp/v2/product?per_page=${REST_PAGE_SIZE}&page=${page}`, {
        allowInsecureTls: options.allowInsecureTls,
      });
    } catch (err) {
      if (page === 1) return false;
      if (err instanceof HttpStatusError && !err.retryable) break;
      throw err;
    }
    if (!Array.isArray(data) || data.length === 0) break;
    for (const item of data) {
      if (item.link) {
        push(item.link);
        discovered += 1;
      }
    }
    onProgress(discovered);
    if (data.length < REST_PAGE_SIZE) break;
  }
  return true;
}

async function guessShopUrl(origin: string, options: ScrapeJobOptions): Promise<string> {
  const candidates = ["/shop/", "/store/", "/products/", "/product-category/all/"];
  for (const path of candidates) {
    try {
      await fetchHtml(`${origin}${path}`, { method: "HEAD", allowInsecureTls: options.allowInsecureTls, timeoutMs: 8000 });
      return `${origin}${path}`;
    } catch {
      continue;
    }
  }
  return origin;
}

async function crawlArchive(
  startUrl: string,
  options: ScrapeJobOptions,
  push: (url: string) => void,
  onProgress: (n: number) => void,
  shouldStop?: () => boolean,
): Promise<void> {
  const seen = new Set<string>();
  let currentUrl: string | null = startUrl;

  for (let page = 0; page < MAX_ARCHIVE_PAGES && currentUrl; page++) {
    if (shouldStop?.()) break;
    const html: string = await fetchHtml(currentUrl, { allowInsecureTls: options.allowInsecureTls });
    const $ = cheerio.load(html);

    for (const selector of ARCHIVE_PRODUCT_LINK_SELECTORS) {
      $(selector).each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        const absolute = new URL(href, currentUrl!).toString();
        if (seen.has(absolute)) return;
        seen.add(absolute);
        push(absolute);
      });
    }
    onProgress(seen.size);

    let nextHref: string | undefined;
    for (const selector of ARCHIVE_NEXT_PAGE_SELECTORS) {
      const found = $(selector).first().attr("href");
      if (found) {
        nextHref = found;
        break;
      }
    }
    currentUrl = nextHref ? new URL(nextHref, currentUrl).toString() : null;
  }
}

/**
 * Pushes each discovered product URL into `push` as soon as it's found —
 * same pipelining rationale as the Shopify engine: scrape workers can start
 * on the first handful of products while the REST pagination (or archive
 * crawl) is still in flight for the rest of the catalog.
 */
export async function discoverWordPressProductUrls(
  options: ScrapeJobOptions,
  push: (url: string) => void,
  onProgress: (n: number) => void,
  shouldStop?: () => boolean,
): Promise<void> {
  const origin = baseUrlFor(options);

  if (options.scope === "collection") {
    await crawlArchive(options.inputUrl.replace(/\/$/, "") + "/", options, push, onProgress, shouldStop);
    return;
  }

  let pushedViaRest = 0;
  const endpointExists = await discoverViaRest(
    origin,
    options,
    (url) => {
      pushedViaRest += 1;
      push(url);
    },
    onProgress,
    shouldStop,
  );
  if (endpointExists && pushedViaRest > 0) return;
  if (shouldStop?.()) return;

  const shopUrl = await guessShopUrl(origin, options);
  await crawlArchive(shopUrl, options, push, onProgress, shouldStop);
}

export async function scrapeWordPressProduct(url: string, options: ScrapeJobOptions): Promise<ScrapedProduct> {
  const html = await fetchHtml(url, { allowInsecureTls: options.allowInsecureTls });
  const $ = cheerio.load(html);

  const title = firstText($, PRODUCT_TITLE_SELECTORS) ?? "Untitled product";
  const salePriceText = firstText($, PRODUCT_SALE_PRICE_SELECTORS);
  const regularPriceText = firstText($, PRODUCT_REGULAR_PRICE_SELECTORS);
  const price = parseMoney(salePriceText ?? regularPriceText ?? undefined);
  const compareAtPrice = salePriceText ? parseMoney(regularPriceText ?? undefined) : null;

  const images: string[] = [];
  for (const selector of PRODUCT_IMAGE_SELECTORS) {
    $(selector).each((_, el) => {
      const src = $(el).attr("data-large_image") || $(el).attr("data-src") || $(el).attr("src");
      if (src) images.push(new URL(src, url).toString());
    });
    if (images.length > 0) break;
  }

  const stockEl = firstMatch($, [".stock"]);
  const stockText = stockEl?.text().trim() ?? null;
  const isOutOfStock = stockEl ? stockEl.hasClass("out-of-stock") || /out of stock/i.test(stockText ?? "") : null;

  const sku = firstText($, PRODUCT_SKU_SELECTORS);
  const categories = $(PRODUCT_CATEGORY_SELECTORS.join(", "))
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const tags = $(PRODUCT_TAG_SELECTORS.join(", "))
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const descriptionHtml = firstMatch($, PRODUCT_DESCRIPTION_SELECTORS)?.html()?.trim() ?? null;

  const customFields = extractCustomFields($, { containerClasses: options.containerClasses });

  return {
    platform: "wordpress",
    productId: url,
    name: title,
    url,
    sku: sku && sku.toLowerCase() !== "n/a" ? sku : null,
    vendor: null,
    currency: null,
    price,
    compareAtPrice,
    availability: stockText,
    isOutOfStock,
    stockQuantity: null,
    categories,
    tags,
    descriptionHtml,
    images: Array.from(new Set(images)),
    videos: [],
    customFields,
    scrapedAt: new Date().toISOString(),
  };
}
