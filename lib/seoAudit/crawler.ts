import "server-only";
import { safeFetch, SsrfBlockedError } from "./safeFetch";
import { parsePageHtml } from "./htmlParsing";
import { MAX_PAGES_LIMIT } from "./constants";
import type { Finding, ParsedPage } from "./types";

export { MAX_PAGES_LIMIT, DEFAULT_MAX_PAGES, MAX_PAGES_OPTIONS } from "./constants";

const CRAWL_CONCURRENCY = 6;

export interface CrawlResult {
  /** Every same-origin page URL this audit actually visited, in the order they finished. */
  pages: string[];
  usedSitemap: boolean;
  robotsTxtFound: boolean;
  robotsTxtBody: string | null;
  sitemapUrl: string | null;
}

/** Emitted live as the crawl progresses, so the UI can show real-time findings instead of a single spinner. */
export type CrawlEvent =
  | { type: "robots-checked"; found: boolean }
  | { type: "sitemap-checked"; found: boolean; url: string | null; pageCount: number }
  | { type: "page-queued"; url: string; queueSize: number }
  | {
      type: "page-crawled";
      url: string;
      title: string | null;
      status: number;
      ok: true;
      crawledCount: number;
      queueSize: number;
    }
  | { type: "page-skipped"; url: string; reason: string; crawledCount: number }
  | { type: "page-error"; url: string; message: string; crawledCount: number };

export type EmitCrawlEvent = (event: CrawlEvent) => void;

/** Pulls every `<loc>...</loc>` value out of a sitemap or sitemap-index XML document — a light regex extraction is enough here since sitemaps are a simple, well-known schema and nothing here is ever executed, only read as plain URL strings. */
function extractSitemapLocs(xml: string): string[] {
  const matches = xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi);
  return Array.from(matches, (m) => m[1].trim()).filter(Boolean);
}

/** A `<sitemapindex>` root lists OTHER sitemap files, not pages — its `<loc>` entries need to be followed one level deeper rather than treated as page URLs themselves. A `<urlset>` root is the real, page-listing kind. */
function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** `<loc>` entries pointing at another sitemap (a `.xml` — or `.xml.gz`, gzip-compressed sitemaps being common — path) are never real pages, whether they show up inside a proper `<sitemapindex>` or, non-standardly, mixed into a `<urlset>`. */
function looksLikeSitemapFile(url: string): boolean {
  try {
    return /\.xml(\.gz)?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// Links to these never lead to another HTML page — skipping them up front
// saves a wasted fetch and a crawl-budget slot instead of only discovering
// they're not HTML after actually fetching them.
const NON_PAGE_EXTENSION = /\.(jpe?g|png|gif|svg|webp|avif|ico|bmp|css|js|mjs|json|xml|xml\.gz|pdf|zip|rar|7z|mp4|mp3|wav|woff2?|ttf|eot|otf|txt|csv)$/i;

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function isCrawlableLink(url: URL): boolean {
  return !NON_PAGE_EXTENSION.test(url.pathname);
}

const MAX_SITEMAP_INDEX_DEPTH = 2;

/**
 * Resolves a sitemap URL down to real page URLs — recursing into a
 * `<sitemapindex>`'s own sub-sitemaps (very common for a Shopify store:
 * `sitemap.xml` is typically an index pointing at `sitemap_products_1.xml`,
 * `sitemap_pages_1.xml`, etc., none of which are pages themselves) until it
 * hits an actual `<urlset>`. `depth` guards against a pathologically
 * self-nesting sitemap index rather than trusting the site not to have one.
 */
async function resolveSitemapPages(sitemapUrl: string, originOnly: string, depth: number, cap: number): Promise<string[]> {
  if (depth > MAX_SITEMAP_INDEX_DEPTH) return [];

  const res = await safeFetch(sitemapUrl);
  if (res.status < 200 || res.status >= 300) return [];

  const locs = extractSitemapLocs(res.body).filter((loc) => isSameOrigin(loc, originOnly));

  if (isSitemapIndex(res.body)) {
    const pages: string[] = [];
    for (const subSitemapUrl of locs) {
      if (pages.length >= cap) break;
      try {
        pages.push(...(await resolveSitemapPages(subSitemapUrl, originOnly, depth + 1, cap)));
      } catch {
        // This particular sub-sitemap didn't pan out — the others still might.
      }
    }
    return pages;
  }

  // A real urlset — still filtering out anything sitemap-shaped as a
  // defense-in-depth measure, in case a non-standard urlset mixes in a
  // sitemap reference rather than only ever listing real pages.
  return locs.filter((loc) => !looksLikeSitemapFile(loc));
}

interface DiscoveryResult {
  robotsTxtFound: boolean;
  robotsTxtBody: string | null;
  sitemapUrl: string | null;
  sitemapPages: string[];
}

/** robots.txt + sitemap.xml discovery — the seed for the real BFS crawl below, not the whole crawl itself anymore. */
async function discoverSeed(origin: string, originOnly: string, cap: number, onEvent: EmitCrawlEvent): Promise<DiscoveryResult> {
  let robotsTxtFound = false;
  let robotsTxtBody: string | null = null;
  try {
    const robots = await safeFetch(new URL("/robots.txt", origin).toString());
    if (robots.status >= 200 && robots.status < 300) {
      robotsTxtFound = true;
      robotsTxtBody = robots.body;
    }
  } catch (err) {
    // An SSRF block means the DOMAIN ITSELF isn't a legitimate audit
    // target (resolves to a private/loopback/reserved address) — that has
    // to fail the whole audit loudly and immediately, not get absorbed
    // into "well, no robots.txt then" and quietly retried on every
    // subsequent fetch this function makes.
    if (err instanceof SsrfBlockedError) throw err;
    // Any other failure just means no robots.txt — not fatal, noted as absent.
  }
  onEvent({ type: "robots-checked", found: robotsTxtFound });

  const sitemapFromRobots = robotsTxtBody?.match(/^sitemap:\s*(\S+)/im)?.[1];
  const sitemapCandidates = [sitemapFromRobots, new URL("/sitemap.xml", origin).toString()].filter(
    (v): v is string => Boolean(v),
  );

  for (const sitemapUrl of sitemapCandidates) {
    try {
      const pages = await resolveSitemapPages(sitemapUrl, originOnly, 0, cap);
      if (pages.length > 0) {
        const deduped = Array.from(new Set(pages)).slice(0, cap);
        onEvent({ type: "sitemap-checked", found: true, url: sitemapUrl, pageCount: deduped.length });
        return { robotsTxtFound, robotsTxtBody, sitemapUrl, sitemapPages: deduped };
      }
    } catch (err) {
      if (err instanceof SsrfBlockedError) throw err;
      // This candidate didn't pan out — try the next one.
    }
  }

  onEvent({ type: "sitemap-checked", found: false, url: null, pageCount: 0 });
  return { robotsTxtFound, robotsTxtBody, sitemapUrl: null, sitemapPages: [] };
}

export interface CrawlOutcome {
  crawl: CrawlResult;
  parsedPages: ParsedPage[];
  findings: Finding[];
}

/**
 * The real crawl: seeds from the sitemap when there is one (a far more
 * representative starting set than blind link-following), then does a
 * genuine breadth-first crawl from there — every page it fetches has its
 * own same-origin links harvested and queued too, not just the homepage's.
 * Bounded by `cap` (never an unbounded crawl of a real store) and run with
 * bounded concurrency, emitting a `CrawlEvent` for every step so the UI can
 * show real-time progress instead of one spinner for the whole run.
 */
export async function crawlSite(rawOrigin: string, cap: number, onEvent: EmitCrawlEvent): Promise<CrawlOutcome> {
  // Run the seed through the same URL normalization every resolved link
  // gets (`new URL(...).toString()`) — otherwise the bare origin as typed
  // (no trailing slash) and that exact same page reached via a resolved
  // link (which normalizes to a trailing slash) count as two "different"
  // pages instead of one.
  const origin = new URL(rawOrigin).toString();
  const originOnly = new URL(rawOrigin).origin;
  const boundedCap = Math.max(1, Math.min(cap, MAX_PAGES_LIMIT));

  const seed = await discoverSeed(origin, originOnly, boundedCap, onEvent);

  const visited = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];
  const parsedPages: ParsedPage[] = [];
  const findings: Finding[] = [];

  function enqueue(url: string) {
    if (visited.size + queued.size >= boundedCap) return;
    if (visited.has(url) || queued.has(url)) return;
    queued.add(url);
    queue.push(url);
    onEvent({ type: "page-queued", url, queueSize: queue.length });
  }

  const initialSeeds = seed.sitemapPages.length > 0 ? seed.sitemapPages : [origin];
  for (const url of initialSeeds) enqueue(url);

  async function processOne(url: string) {
    try {
      const res = await safeFetch(url);
      if (res.status >= 400) {
        findings.push({
          category: "technical",
          severity: "critical",
          page: url,
          message: `Page responded with status ${res.status}.`,
          recommendation: "Check why this page isn't loading successfully — a page search engines can't fetch can't be indexed either.",
        });
        onEvent({ type: "page-error", url, message: `HTTP ${res.status}`, crawledCount: visited.size });
        return;
      }
      if (res.finalUrl !== url) {
        findings.push({
          category: "technical",
          severity: "info",
          page: url,
          message: `This URL redirects to ${res.finalUrl}.`,
          recommendation: "If this redirect isn't intentional, point internal links straight at the final URL instead of relying on the redirect.",
        });
      }

      // A sitemap (or a page's own links) can legitimately point at a
      // non-HTML resource — running HTML checks against those produces
      // nonsense findings, so Content-Type, not the URL's own shape,
      // decides whether this is actually a page to run checks on.
      const contentType = res.headers["content-type"] ?? "";
      if (!contentType.toLowerCase().includes("html")) {
        findings.push({
          category: "technical",
          severity: "info",
          page: url,
          message: `This URL isn't an HTML page (Content-Type: ${contentType || "unknown"}) — skipped from on-page/technical/structured-data checks.`,
          recommendation: "If this was linked or listed in the sitemap by mistake, fix or remove that reference.",
        });
        onEvent({ type: "page-skipped", url, reason: "non-html", crawledCount: visited.size });
        return;
      }

      const parsed = parsePageHtml(res.finalUrl, res.status, res.body);
      parsedPages.push(parsed);
      onEvent({
        type: "page-crawled",
        url: res.finalUrl,
        title: parsed.title,
        status: res.status,
        ok: true,
        crawledCount: visited.size,
        queueSize: queue.length,
      });

      for (const link of parsed.links) {
        try {
          const resolved = new URL(link.href, res.finalUrl);
          resolved.hash = "";
          const resolvedUrl = resolved.toString();
          if (isSameOrigin(resolvedUrl, originOnly) && isCrawlableLink(resolved) && !looksLikeSitemapFile(resolvedUrl)) {
            enqueue(resolvedUrl);
          }
        } catch {
          // Not a valid URL (e.g. `mailto:`, `javascript:`) — skip it.
        }
      }
    } catch (err) {
      // An SSRF block on a page discovered mid-crawl (via a link, not the
      // seed domain itself) just means that one link resolved somewhere
      // this audit refuses to fetch — noted and skipped, not fatal to the
      // whole run the way a block on the seed domain is (see discoverSeed).
      findings.push({
        category: "technical",
        severity: "critical",
        page: url,
        message:
          err instanceof SsrfBlockedError
            ? "This link points somewhere this audit won't fetch (private/internal address)."
            : err instanceof Error
              ? `Couldn't fetch this page: ${err.message}`
              : "Couldn't fetch this page.",
        recommendation: "Confirm the page is actually reachable — this audit couldn't load it at all.",
      });
      onEvent({ type: "page-error", url, message: err instanceof Error ? err.message : "Fetch failed", crawledCount: visited.size });
    }
  }

  async function worker() {
    while (queue.length > 0 && visited.size < boundedCap) {
      const url = queue.shift();
      if (url === undefined) return;
      queued.delete(url);
      if (visited.has(url)) continue;
      visited.add(url);
      await processOne(url);
    }
  }

  await Promise.all(Array.from({ length: CRAWL_CONCURRENCY }, () => worker()));

  return {
    crawl: {
      pages: Array.from(visited),
      usedSitemap: seed.sitemapPages.length > 0,
      robotsTxtFound: seed.robotsTxtFound,
      robotsTxtBody: seed.robotsTxtBody,
      sitemapUrl: seed.sitemapUrl,
    },
    parsedPages,
    findings,
  };
}
