import "server-only";
import * as cheerio from "cheerio";
import { fetchGraphql } from "../http";
import { extractCustomFields } from "../customFields";
import type { ScrapeJobOptions, ScrapedProduct } from "../types";

const PAGE_SIZE = 50;
const MAX_PAGES = 400;

interface MagentoMoney {
  value: number | null;
  currency: string | null;
}

interface MagentoPriceRange {
  minimum_price: { regular_price: MagentoMoney; final_price: MagentoMoney };
}

interface MagentoMediaItem {
  url: string;
}

interface MagentoCategory {
  name: string;
}

interface MagentoConfigurableVariant {
  product: { media_gallery: MagentoMediaItem[] | null };
}

export interface MagentoProductNode {
  id: number;
  sku: string;
  name: string;
  url_key: string | null;
  description: { html: string } | null;
  short_description: { html: string } | null;
  price_range: MagentoPriceRange;
  image: MagentoMediaItem | null;
  media_gallery: MagentoMediaItem[] | null;
  categories: MagentoCategory[] | null;
  stock_status?: string | null;
  only_x_left_in_stock?: number | null;
  variants?: MagentoConfigurableVariant[] | null;
}

interface ProductsQueryData {
  products: {
    total_count: number;
    page_info: { current_page: number; total_pages: number };
    items: MagentoProductNode[];
  };
}

interface CategoryListData {
  categoryList: { id: number }[];
}

function baseUrlFor(options: ScrapeJobOptions): string {
  return new URL(options.inputUrl).origin;
}

function graphqlEndpoint(options: ScrapeJobOptions): string {
  return `${baseUrlFor(options)}/graphql`;
}

// Keyed per GraphQL endpoint — a single shared boolean here would leak one
// store's schema support across jobs against a DIFFERENT store (whichever
// probed first would incorrectly decide it for every later store, causing
// spurious GraphQL errors querying fields that don't exist on that other
// install). Endpoints are few and long-lived for the process's life, so an
// unbounded map is fine here.
const stockFieldSupportByEndpoint = new Map<string, boolean>();

async function probeStockFields(options: ScrapeJobOptions): Promise<boolean> {
  const endpoint = graphqlEndpoint(options);
  const cached = stockFieldSupportByEndpoint.get(endpoint);
  if (cached !== undefined) return cached;
  let supported: boolean;
  try {
    await fetchGraphql(
      endpoint,
      `{ products(filter: {}, pageSize: 1) { items { stock_status only_x_left_in_stock } } }`,
      {},
      { allowInsecureTls: options.allowInsecureTls, timeoutMs: 8000 },
    );
    supported = true;
  } catch {
    supported = false;
  }
  stockFieldSupportByEndpoint.set(endpoint, supported);
  return supported;
}

function categoryUrlPathFromInput(inputUrl: string): string | null {
  try {
    const url = new URL(inputUrl);
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "");
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Throws rather than falling back to "no filter" when a collection scope's
 * category can't be resolved — silently scraping the ENTIRE catalog when
 * the user asked for one collection would be a much worse surprise than a
 * clear error telling them the URL wasn't recognized as a category page.
 */
async function resolveCategoryId(options: ScrapeJobOptions): Promise<number> {
  const path = categoryUrlPathFromInput(options.inputUrl);
  if (!path) {
    throw new Error("That URL doesn't look like a Magento category page — expected a path like /category-name.html.");
  }
  const data = await fetchGraphql<CategoryListData>(
    graphqlEndpoint(options),
    `query($path: String!) { categoryList(filters: { url_path: { eq: $path } }) { id } }`,
    { path },
    { allowInsecureTls: options.allowInsecureTls },
  );
  const id = data.categoryList[0]?.id;
  if (id === undefined) {
    throw new Error(`Couldn't find a Magento category matching "${path}".`);
  }
  return id;
}

function buildProductsQuery(includeStockFields: boolean): string {
  const stockFields = includeStockFields ? "stock_status\n      only_x_left_in_stock" : "";
  return `
    query($filter: ProductAttributeFilterInput!, $pageSize: Int!, $currentPage: Int!) {
      products(filter: $filter, pageSize: $pageSize, currentPage: $currentPage) {
        total_count
        page_info { current_page total_pages }
        items {
          id
          sku
          name
          url_key
          description { html }
          short_description { html }
          price_range {
            minimum_price {
              regular_price { value currency }
              final_price { value currency }
            }
          }
          image { url }
          media_gallery { url }
          categories { name }
          ${stockFields}
          ... on ConfigurableProduct {
            variants { product { media_gallery { url } } }
          }
        }
      }
    }
  `;
}

function collectAllImageUrls(product: MagentoProductNode): string[] {
  const urls = new Set<string>();
  const strip = (url: string) => url.replace(/\/cache\/[a-f0-9]+\//i, "/");
  if (product.image?.url) urls.add(strip(product.image.url));
  for (const media of product.media_gallery ?? []) {
    if (media.url) urls.add(strip(media.url));
  }
  for (const variant of product.variants ?? []) {
    for (const media of variant.product.media_gallery ?? []) {
      if (media.url) urls.add(strip(media.url));
    }
  }
  return Array.from(urls);
}

/** Same pipelining rationale as the Shopify/WordPress engines — pushes each page's items immediately so scrape workers aren't idle waiting for the whole catalog to page through. */
export async function discoverMagentoProducts(
  options: ScrapeJobOptions,
  push: (product: MagentoProductNode) => void,
  onProgress: (n: number) => void,
  shouldStop?: () => boolean,
): Promise<void> {
  const includeStockFields = await probeStockFields(options);
  const query = buildProductsQuery(includeStockFields);

  let filter: Record<string, unknown> = {};
  if (options.scope === "collection") {
    const categoryId = await resolveCategoryId(options);
    filter = { category_id: { eq: String(categoryId) } };
  }

  let discovered = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (shouldStop?.()) break;
    const data = await fetchGraphql<ProductsQueryData>(
      graphqlEndpoint(options),
      query,
      { filter, pageSize: PAGE_SIZE, currentPage: page },
      { allowInsecureTls: options.allowInsecureTls },
    );
    for (const item of data.products.items) {
      push(item);
      discovered += 1;
    }
    onProgress(discovered);
    if (page >= data.products.page_info.total_pages) break;
  }
}

function stripHtml(html: string): string {
  return cheerio.load(html)("body").text().replace(/\s+/g, " ").trim();
}

export async function assembleMagentoProduct(product: MagentoProductNode, options: ScrapeJobOptions): Promise<ScrapedProduct> {
  const base = baseUrlFor(options);
  const url = product.url_key ? `${base}/${product.url_key}.html` : `${base}/catalog/product/view/id/${product.id}`;

  const descriptionHtml = product.description?.html || product.short_description?.html || null;
  let containerFields: ScrapedProduct["customFields"] = [];
  if (options.containerClasses.length > 0 && descriptionHtml) {
    const $ = cheerio.load(descriptionHtml);
    containerFields = extractCustomFields($, { containerClasses: options.containerClasses });
  } else if (descriptionHtml) {
    const $ = cheerio.load(descriptionHtml);
    containerFields = extractCustomFields($, { containerClasses: [] });
  }

  const regular = product.price_range.minimum_price.regular_price;
  const final = product.price_range.minimum_price.final_price;

  return {
    platform: "magento",
    productId: String(product.id),
    name: product.name,
    url,
    sku: product.sku || null,
    vendor: null,
    currency: final.currency ?? regular.currency,
    price: final.value ?? regular.value,
    compareAtPrice: final.value !== null && regular.value !== null && final.value < regular.value ? regular.value : null,
    availability: product.stock_status ?? null,
    isOutOfStock: product.stock_status ? product.stock_status !== "IN_STOCK" : null,
    stockQuantity: product.only_x_left_in_stock ?? null,
    categories: (product.categories ?? []).map((c) => c.name),
    tags: [],
    descriptionHtml: descriptionHtml ? stripHtml(descriptionHtml) : null,
    images: collectAllImageUrls(product),
    videos: [],
    customFields: containerFields,
    scrapedAt: new Date().toISOString(),
  };
}
