export type ScraperPlatform = "shopify" | "wordpress" | "magento";

/** "collection" = one specific collection/category/archive URL; "store" = crawl the whole catalog. */
export type ScrapeScope = "collection" | "store";

export interface CustomFieldEntry {
  label: string;
  value: string;
}

export interface ScrapedProduct {
  platform: ScraperPlatform;
  productId: string;
  name: string;
  url: string;
  sku: string | null;
  vendor: string | null;
  currency: string | null;
  price: number | null;
  compareAtPrice: number | null;
  availability: string | null;
  isOutOfStock: boolean | null;
  stockQuantity: number | null;
  categories: string[];
  tags: string[];
  descriptionHtml: string | null;
  images: string[];
  videos: string[];
  customFields: CustomFieldEntry[];
  scrapedAt: string;
}

export type JobStatus = "queued" | "discovering" | "scraping" | "done" | "error" | "cancelled";

export interface ScrapeJobOptions {
  platform: ScraperPlatform;
  scope: ScrapeScope;
  inputUrl: string;
  /** One field name per line from the UI — if empty, every custom field found gets captured. */
  requestedFields: string[];
  /** CSS class names (no leading dot) whose <li> children get read wholesale as custom fields. */
  containerClasses: string[];
  useCache: boolean;
  allowInsecureTls: boolean;
  /**
   * Skips the extra per-product page fetch used to pull custom spec fields
   * and videos — those only ever come from the rendered product page, not
   * any store's JSON/GraphQL APIs. With this on, a product's name, price,
   * SKU, and (for Shopify) images come entirely from the data already
   * fetched during discovery, with zero additional per-product requests —
   * the whole catalog becomes media-export-ready as fast as discovery
   * itself finishes, at the cost of empty `customFields`/`videos`.
   */
  quickMediaMode: boolean;
}

export interface ScrapeFailure {
  input: string;
  error: string;
}

export interface ScrapeJob {
  id: string;
  options: ScrapeJobOptions;
  status: JobStatus;
  statusMessage: string;
  totalDiscovered: number;
  scrapedCount: number;
  failedCount: number;
  failures: ScrapeFailure[];
  products: ScrapedProduct[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** The shape returned to the client — `products` is paginated separately so a large job's status poll stays small. */
export interface ScrapeJobSummary {
  id: string;
  options: ScrapeJobOptions;
  status: JobStatus;
  statusMessage: string;
  totalDiscovered: number;
  scrapedCount: number;
  failedCount: number;
  productCount: number;
  /** The largest `images.length` across every scraped product — how many "position N" checkboxes the media-export exclusion picker needs. */
  maxImageCount: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function summarizeJob(job: ScrapeJob): ScrapeJobSummary {
  let maxImageCount = 0;
  for (const product of job.products) {
    if (product.images.length > maxImageCount) maxImageCount = product.images.length;
  }
  return {
    id: job.id,
    options: job.options,
    status: job.status,
    statusMessage: job.statusMessage,
    totalDiscovered: job.totalDiscovered,
    scrapedCount: job.scrapedCount,
    failedCount: job.failedCount,
    productCount: job.products.length,
    maxImageCount,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}
