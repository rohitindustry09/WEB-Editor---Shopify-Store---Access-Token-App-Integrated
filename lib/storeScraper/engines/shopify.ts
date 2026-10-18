import "server-only";
import * as cheerio from "cheerio";
import { fetchJson, fetchHtml } from "../http";
import { extractCustomFields } from "../customFields";
import type { ScrapeJobOptions, ScrapedProduct } from "../types";

const PAGE_SIZE = 250;
const MAX_PAGES = 200;

interface ShopifyVariant {
  price: string;
  compare_at_price: string | null;
  sku: string | null;
  available: boolean;
}

interface ShopifyImage {
  src: string;
}

export interface ShopifyProduct {
  id: number;
  handle: string;
  title: string;
  vendor: string | null;
  product_type: string | null;
  tags: string[] | string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
  body_html: string | null;
}

interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

const STOCK_QUANTITY_PATTERN = /only\s+(\d+)\s+left|(\d+)\s+item[s]?\s+(?:in\s+stock|available)/i;
const VIDEO_SRC_PATTERN = /\.(mp4|webm|mov)(\?|$)/i;

function baseUrlFor(options: ScrapeJobOptions): string {
  return new URL(options.inputUrl).origin;
}

function listingUrlFor(options: ScrapeJobOptions): string {
  if (options.scope === "collection") {
    // The user-provided URL is expected to be a /collections/<handle> page.
    return options.inputUrl.replace(/\/$/, "");
  }
  return baseUrlFor(options);
}

/**
 * Pushes each page's FULL product objects into `push` as soon as that page
 * arrives (not just handles) — lets the scrape workers (draining the same
 * queue) start on page 1's products while page 2 is still in flight,
 * instead of sitting idle through the entire discovery pass on a large
 * store. Pushing the full object, not just the handle, is what lets
 * `scrapeShopifyProduct` skip re-fetching `/products/<handle>.json` —
 * Shopify's own product-listing JSON already has everything that endpoint
 * would return (images, price, SKU, description, ...), so re-fetching it
 * per product was a fully redundant request this discovery pass had
 * already paid for.
 */
export async function discoverShopifyHandles(
  options: ScrapeJobOptions,
  push: (product: ShopifyProduct) => void,
  onProgress: (discovered: number) => void,
  shouldStop?: () => boolean,
): Promise<void> {
  const listingUrl = listingUrlFor(options);
  let discovered = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (shouldStop?.()) break;
    const url = `${listingUrl}/products.json?limit=${PAGE_SIZE}&page=${page}`;
    const data = await fetchJson<ShopifyProductsResponse>(url, { allowInsecureTls: options.allowInsecureTls });
    if (!data.products || data.products.length === 0) break;
    for (const product of data.products) {
      push(product);
      discovered += 1;
    }
    onProgress(discovered);
    if (data.products.length < PAGE_SIZE) break;
  }
}

function tagsToArray(tags: string[] | string): string[] {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function extractVideosFromHtml($: cheerio.CheerioAPI): string[] {
  const videos = new Set<string>();
  $("video source[src], video[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) videos.add(src);
  });
  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (/youtube\.com|youtu\.be|vimeo\.com/i.test(src)) videos.add(src);
  });
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (VIDEO_SRC_PATTERN.test(href)) videos.add(href);
  });
  return Array.from(videos);
}

/**
 * Assembles a `ScrapedProduct` from a product object already fetched
 * during discovery — no `/products/<handle>.json` re-fetch, see
 * `discoverShopifyHandles`'s own comment. The ONLY thing this may still
 * fetch is the rendered product page, and only for what nothing else can
 * provide: custom spec fields and videos live purely in theme-rendered
 * HTML, never in Shopify's JSON. Skipped entirely when
 * `options.quickMediaMode` is on — the caller is saying they only want
 * media (images) fast, not spec fields, so this becomes a pure in-memory
 * assembly with zero additional network requests per product.
 */
export async function scrapeShopifyProduct(product: ShopifyProduct, options: ScrapeJobOptions): Promise<ScrapedProduct> {
  const base = baseUrlFor(options);
  const productUrl = `${base}/products/${product.handle}`;
  const variant = product.variants[0];
  const price = variant ? Number(variant.price) : null;
  const compareAtPrice = variant?.compare_at_price ? Number(variant.compare_at_price) : null;

  let stockQuantity: number | null = null;
  let customFields: ScrapedProduct["customFields"] = [];
  let videos: string[] = [];

  if (!options.quickMediaMode) {
    const html = await fetchHtml(productUrl, { allowInsecureTls: options.allowInsecureTls });
    const $ = cheerio.load(html);
    const bodyText = $("body").text();
    const stockMatch = bodyText.match(STOCK_QUANTITY_PATTERN);
    stockQuantity = stockMatch ? Number(stockMatch[1] ?? stockMatch[2]) : null;
    customFields = extractCustomFields($, { containerClasses: options.containerClasses });
    videos = extractVideosFromHtml($);
  }

  return {
    platform: "shopify",
    productId: String(product.id),
    name: product.title,
    url: productUrl,
    sku: variant?.sku || null,
    vendor: product.vendor || null,
    currency: null,
    price: Number.isFinite(price) ? price : null,
    compareAtPrice: compareAtPrice && Number.isFinite(compareAtPrice) ? compareAtPrice : null,
    availability: variant ? (variant.available ? "In stock" : "Out of stock") : null,
    isOutOfStock: variant ? !variant.available : null,
    stockQuantity,
    categories: product.product_type ? [product.product_type] : [],
    tags: tagsToArray(product.tags),
    descriptionHtml: product.body_html || null,
    images: product.images.map((img) => img.src).filter(Boolean),
    videos,
    customFields,
    scrapedAt: new Date().toISOString(),
  };
}
