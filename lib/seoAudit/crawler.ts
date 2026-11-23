import "server-only";
import { safeFetch, SsrfBlockedError } from "./safeFetch";
import { parsePageHtml } from "./htmlParsing";
import { MAX_PAGES_LIMIT, MAX_WORKERS } from "./constants";
import { clearCheckpoint, loadRecords, openCheckpoint, siteKey, type PageRecord } from "./checkpoint";
import type { Finding, ParsedPage } from "./types";

export { MAX_PAGES_LIMIT, DEFAULT_MAX_PAGES, MAX_PAGES_OPTIONS } from "./constants";

// Shopify's storefront rate-limits a fast crawler (HTTP 429), so pages are fetched gently and, when a 429 does come back,
// every worker backs off together and the page is retried instead of being reported as broken.
// Workers: more for the connected store (it starts fast and the pacer below slows everything down the moment Shopify
// pushes back), fewer for someone else's site.
const CRAWL_CONCURRENCY = 3;
const OWN_STORE_CONCURRENCY = 10;
const START_IN_FLIGHT = 3;
const CLEAN_RUN_TO_SPEED_UP = 40;
const MAX_429_RETRIES = 5;
const MAX_TRANSIENT_RETRIES = 3;
const TRANSIENT_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Limits how many requests are in flight at once, and finds the most the site tolerates. It starts at a few and creeps
 * up while everything succeeds; the first 429 pins a ceiling just below the level that triggered it and pauses every
 * worker for the time the site asks. (A fixed delay between requests was tried first, but it serialised all workers:
 * after a few 429s the whole crawl ran at one request per few seconds, however many workers were set.)
 */
function createLimiter(maxWorkers: number) {
  let limit = Math.min(maxWorkers, START_IN_FLIGHT);
  let ceiling = maxWorkers;
  let active = 0;
  let cleanRun = 0;
  let pausedUntil = 0;
  let lastCut = 0;
  const waiting: (() => void)[] = [];

  const wake = () => {
    while (waiting.length > 0 && active < limit) waiting.shift()?.();
  };

  return {
    async acquire(): Promise<() => void> {
      for (;;) {
        const pause = pausedUntil - Date.now();
        if (pause > 0) {
          await sleep(pause);
          continue;
        }
        if (active < limit) break;
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        wake();
      };
    },
    /** A 429: remember the level that was too much, drop below it, and pause everyone. */
    rateLimited(pauseMs: number): void {
      cleanRun = 0;
      // Several requests in flight usually all come back 429 together: that is one signal, not several.
      if (Date.now() - lastCut > 3000) {
        lastCut = Date.now();
        ceiling = Math.max(1, Math.min(ceiling, limit - 1));
        limit = ceiling;
      }
      pausedUntil = Math.max(pausedUntil, Date.now() + pauseMs);
    },
    ok(): void {
      cleanRun += 1;
      if (cleanRun >= CLEAN_RUN_TO_SPEED_UP && limit < ceiling) {
        cleanRun = 0;
        limit += 1;
        wake();
      }
    },
  };
}

function retryAfterMs(header: string | undefined, attempt: number): number {
  const seconds = header ? Number(header) : NaN;
  const base = Number.isFinite(seconds) ? seconds * 1000 : 1500 * 2 ** attempt;
  return Math.min(base, MAX_BACKOFF_MS);
}

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
  | { type: "checkpoint-loaded"; cached: number }
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
export async function crawlSite(rawOrigin: string, cap: number, onEvent: EmitCrawlEvent, extraSeeds: string[] = [], workers = 0, mode: "resume" | "fresh" = "fresh"): Promise<CrawlOutcome> {
  // Run the seed through the same URL normalization every resolved link
  // gets (`new URL(...).toString()`) — otherwise the bare origin as typed
  // (no trailing slash) and that exact same page reached via a resolved
  // link (which normalizes to a trailing slash) count as two "different"
  // pages instead of one.
  let origin = new URL(rawOrigin).toString();
  let originOnly = new URL(rawOrigin).origin;
  // A store address often redirects (the .myshopify.com address to the real domain, or bare to www). Follow it once so
  // sitemaps and same-site link checks use the host the site really lives on.
  try {
    const home = await safeFetch(origin);
    const finalOrigin = new URL(home.finalUrl).origin;
    if (finalOrigin !== originOnly) {
      originOnly = finalOrigin;
      origin = new URL(home.finalUrl).origin + "/";
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err;
  }
  const boundedCap = Math.max(1, Math.min(cap, MAX_PAGES_LIMIT));

  const seed = await discoverSeed(origin, originOnly, boundedCap, onEvent);

  // Saved progress: resume reuses every page that already has a final result; fresh deletes what was saved.
  const site = siteKey(new URL(originOnly).hostname);
  if (mode === "fresh") await clearCheckpoint(site);
  const loaded = mode === "resume" ? await loadRecords(site) : new Map<string, PageRecord>();
  if (loaded.size > 0) onEvent({ type: "checkpoint-loaded", cached: loaded.size });
  const checkpoint = openCheckpoint(site, loaded.size);

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

  const live = extraSeeds.filter((u) => isSameOrigin(u, originOnly));
  const initialSeeds = Array.from(new Set([origin, ...live, ...seed.sitemapPages]));
  for (const url of initialSeeds) enqueue(url);

  const workerCount = workers > 0 ? Math.min(workers, MAX_WORKERS) : extraSeeds.length > 0 ? OWN_STORE_CONCURRENCY : CRAWL_CONCURRENCY;
  const pacer = createLimiter(workerCount);

  async function fetchPaced(url: string) {
    let transientRetries = 0;
    for (let attempt = 0; ; attempt++) {
      const release = await pacer.acquire();
      let res;
      try {
        res = await safeFetch(url);
        release();
      } catch (err) {
        release();
        // A timeout or dropped connection is usually momentary. A blocked (private) address never is, so it is not retried.
        if (err instanceof SsrfBlockedError || transientRetries >= MAX_TRANSIENT_RETRIES) throw err;
        transientRetries += 1;
        await sleep(TRANSIENT_BACKOFF_MS * transientRetries);
        continue;
      }
      if (res.status === 429) {
        if (attempt >= MAX_429_RETRIES) return res;
        pacer.rateLimited(retryAfterMs(res.headers["retry-after"], attempt));
        continue;
      }
      // 502/503/504 are the server briefly failing, not the page being broken.
      if ([500, 502, 503, 504].includes(res.status) && transientRetries < MAX_TRANSIENT_RETRIES) {
        transientRetries += 1;
        await sleep(TRANSIENT_BACKOFF_MS * transientRetries);
        continue;
      }
      pacer.ok();
      return res;
    }
  }

  /** Fetches one page and describes the outcome — nothing is shared or emitted here, so the result can be saved and replayed. */
  async function fetchRecord(url: string): Promise<PageRecord> {
    const pageFindings: Finding[] = [];
    try {
      const res = await fetchPaced(url);
      if (res.status === 429) {
        // Still rate-limited after every retry: that says nothing about the page itself, so it is not a "broken page".
        pageFindings.push({
          category: "technical",
          severity: "info",
          page: url,
          message: "Could not be checked: the store kept rate-limiting this request (HTTP 429).",
          recommendation: "Run the audit again later or with a smaller page limit to check this page.",
        });
        return { url, outcome: "retry", findings: pageFindings, parsed: null, message: "Rate limited (429) — not checked" };
      }
      if (res.status >= 400) {
        pageFindings.push({
          category: "technical",
          severity: "critical",
          page: url,
          message: `Page responded with status ${res.status}.`,
          recommendation: "Check why this page isn't loading successfully — a page search engines can't fetch can't be indexed either.",
        });
        // A 5xx may be momentary, so it is fetched again on resume; a 4xx is a real answer.
        return { url, outcome: res.status >= 500 ? "retry" : "error", findings: pageFindings, parsed: null, message: `HTTP ${res.status}` };
      }
      if (res.finalUrl !== url) {
        pageFindings.push({
          category: "technical",
          severity: "info",
          page: url,
          message: `This URL redirects to ${res.finalUrl}.`,
          recommendation: "If this redirect isn't intentional, point internal links straight at the final URL instead of relying on the redirect.",
        });
      }

      // A sitemap (or a page's own links) can legitimately point at a non-HTML resource — running HTML checks against
      // those produces nonsense findings, so Content-Type, not the URL's own shape, decides whether it is a page.
      const contentType = res.headers["content-type"] ?? "";
      if (!contentType.toLowerCase().includes("html")) {
        pageFindings.push({
          category: "technical",
          severity: "info",
          page: url,
          message: `This URL isn't an HTML page (Content-Type: ${contentType || "unknown"}) — skipped from on-page/technical/structured-data checks.`,
          recommendation: "If this was linked or listed in the sitemap by mistake, fix or remove that reference.",
        });
        return { url, outcome: "skipped", findings: pageFindings, parsed: null };
      }

      return { url, outcome: "ok", findings: pageFindings, parsed: parsePageHtml(res.finalUrl, res.status, res.body) };
    } catch (err) {
      // An SSRF block on a page discovered mid-crawl (via a link, not the seed domain itself) just means that one link
      // resolved somewhere this audit refuses to fetch — noted and skipped, not fatal to the whole run.
      const blocked = err instanceof SsrfBlockedError;
      pageFindings.push({
        category: "technical",
        severity: "critical",
        page: url,
        message: blocked
          ? "This link points somewhere this audit won't fetch (private/internal address)."
          : err instanceof Error
            ? `Couldn't fetch this page: ${err.message}`
            : "Couldn't fetch this page.",
        recommendation: "Confirm the page is actually reachable — this audit couldn't load it at all.",
      });
      return { url, outcome: blocked ? "error" : "retry", findings: pageFindings, parsed: null, message: err instanceof Error ? err.message : "Fetch failed" };
    }
  }

  /** Adds a page result to the audit and tells the UI, whether it was just fetched or loaded from saved progress. */
  function applyRecord(record: PageRecord) {
    findings.push(...record.findings);
    if (record.parsed) {
      const parsed = record.parsed;
      parsedPages.push(parsed);
      onEvent({ type: "page-crawled", url: parsed.url, title: parsed.title, status: parsed.status, ok: true, crawledCount: visited.size, queueSize: queue.length });
      for (const link of parsed.links) {
        try {
          const resolved = new URL(link.href, parsed.url);
          resolved.hash = "";
          const resolvedUrl = resolved.toString();
          if (isSameOrigin(resolvedUrl, originOnly) && isCrawlableLink(resolved) && !looksLikeSitemapFile(resolvedUrl)) {
            enqueue(resolvedUrl);
          }
        } catch {
          // Not a valid URL (e.g. mailto:, javascript:) — skip it.
        }
      }
    } else if (record.outcome === "skipped") {
      onEvent({ type: "page-skipped", url: record.url, reason: "non-html", crawledCount: visited.size });
    } else {
      onEvent({ type: "page-error", url: record.url, message: record.message ?? "Fetch failed", crawledCount: visited.size });
    }
  }

  async function processOne(url: string) {
    const cached = loaded.get(url);
    if (cached) {
      applyRecord(cached);
      return;
    }
    const record = await fetchRecord(url);
    checkpoint.save(record);
    applyRecord(record);
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

  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    await checkpoint.finish(boundedCap, queue.length === 0);
  }

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
