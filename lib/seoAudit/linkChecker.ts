import "server-only";
import { safeFetch, SsrfBlockedError } from "./safeFetch";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { Finding, ParsedPage } from "./types";

// Confirmed against a real 20-page Shopify store: checking every unique
// link (300+ of them, mostly the store's own product pages) at concurrency
// 8 tripped Shopify's storefront rate limiter, which started returning 429
// for nearly every request — and those 429s were being reported as broken
// links, producing a false "300+ broken links" finding on a site that
// wasn't actually broken. Lower concurrency reduces how often that happens
// in the first place; the 429 retry/backoff below handles the rest.
const LINK_CHECK_CONCURRENCY = 3;
/** A large store has tens of thousands of distinct links and images; checking them all would take hours and trip the rate limiter. */
const MAX_LINKS_CHECKED = 1500;
const RATE_LIMIT_MAX_RETRY_DELAY_MS = 5000;
const RATE_LIMIT_DEFAULT_RETRY_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads a `Retry-After` header (seconds, or an HTTP date) into a millisecond delay, capped so one slow server can't stall the whole check. Falls back to a fixed delay when the header is missing or unparsable. */
function retryDelayMs(retryAfterHeader: string | undefined): number {
  if (!retryAfterHeader) return RATE_LIMIT_DEFAULT_RETRY_DELAY_MS;
  const asSeconds = Number(retryAfterHeader);
  if (Number.isFinite(asSeconds)) return Math.min(asSeconds * 1000, RATE_LIMIT_MAX_RETRY_DELAY_MS);
  const asDate = Date.parse(retryAfterHeader);
  if (!Number.isNaN(asDate)) return Math.min(Math.max(asDate - Date.now(), 0), RATE_LIMIT_MAX_RETRY_DELAY_MS);
  return RATE_LIMIT_DEFAULT_RETRY_DELAY_MS;
}

interface LinkReference {
  url: string;
  /** Every crawled page that links to (or embeds, for images) this URL — one broken link shared across many pages (a footer link, say) is checked once here but still reported against each page that has it. */
  sourcePages: Set<string>;
  isImage: boolean;
}

/** `data:`/`mailto:`/`tel:`/`javascript:` aren't fetchable web resources — nothing to check, and passing them to `safeFetch` would just report a confusing scheme-rejected error instead of being silently, correctly skipped. */
function isCheckableScheme(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function collectLinkReferences(pages: ParsedPage[]): Map<string, LinkReference> {
  const references = new Map<string, LinkReference>();

  const add = (rawUrl: string, sourcePage: string, isImage: boolean) => {
    let absolute: string;
    try {
      absolute = new URL(rawUrl, sourcePage).toString();
    } catch {
      return;
    }
    if (!isCheckableScheme(absolute)) return;

    const existing = references.get(absolute);
    if (existing) {
      existing.sourcePages.add(sourcePage);
    } else {
      references.set(absolute, { url: absolute, sourcePages: new Set([sourcePage]), isImage });
    }
  };

  for (const page of pages) {
    for (const link of page.links) add(link.href, page.url, false);
    for (const image of page.images) add(image.src, page.url, true);
  }

  return references;
}

/**
 * Fetches once, and if the server responds 429 (rate-limited), waits and
 * tries exactly once more before giving up. Returns `null` — meaning
 * "couldn't verify, not necessarily broken" — when it's still 429 after
 * that retry, rather than the HTTP status, so callers can't mistake
 * "rate-limited" for "broken".
 */
async function fetchStatusWithRetry(url: string, method: "HEAD" | "GET"): Promise<number | null> {
  let res = await safeFetch(url, { method, timeoutMs: 8000 });
  if (res.status === 429) {
    await sleep(retryDelayMs(res.headers["retry-after"]));
    res = await safeFetch(url, { method, timeoutMs: 8000 });
    if (res.status === 429) return null;
  }
  return res.status;
}

/**
 * Checks every unique link and image URL referenced across the crawled
 * pages actually resolves. Each URL is checked once (bounded concurrency)
 * no matter how many pages reference it, but a broken one is still reported
 * as a separate finding against every page that links to it — a broken
 * footer link, say, should show up on each page it appears on, not just
 * once in isolation.
 */
export async function checkLinks(pages: ParsedPage[]): Promise<Finding[]> {
  const crawled = new Set(pages.map((p) => p.url));
  // Pages this audit already fetched successfully need no second request.
  const all = Array.from(collectLinkReferences(pages).values()).filter((ref) => !crawled.has(ref.url));
  const references = all.slice(0, MAX_LINKS_CHECKED);
  const findings: Finding[] = [];
  if (all.length > references.length && pages.length > 0) {
    findings.push({
      category: "broken-links",
      severity: "info",
      page: pages[0].url,
      message: `Checked ${references.length.toLocaleString("en-US")} of ${all.length.toLocaleString("en-US")} distinct links and images (the rest were skipped to keep the audit fast and avoid rate limits).`,
      recommendation: "Pages and images are still all crawled; only the extra link-by-link check is sampled on very large stores.",
    });
  }

  await mapWithConcurrency(references, LINK_CHECK_CONCURRENCY, async (ref) => {
    let broken = false;
    let reason = "";

    try {
      const headStatus = await fetchStatusWithRetry(ref.url, "HEAD");
      // null means still rate-limited after a retry — genuinely unverifiable
      // right now, not evidence the link is broken, so it's left unreported.
      if (headStatus === null) return;

      if (headStatus >= 400) {
        // Some servers don't implement HEAD correctly (405, or a wrong
        // status) — a GET is slower but is the ground truth before this
        // gets reported as broken.
        const getStatus = await fetchStatusWithRetry(ref.url, "GET");
        if (getStatus === null) return;
        if (getStatus >= 400) {
          broken = true;
          reason = `responded with status ${getStatus}`;
        }
      }
    } catch (err) {
      broken = true;
      reason = err instanceof SsrfBlockedError ? err.message : err instanceof Error ? err.message : "couldn't be reached";
    }

    if (!broken) return;

    const kind = ref.isImage ? "image" : "link";
    for (const sourcePage of ref.sourcePages) {
      findings.push({
        category: "broken-links",
        severity: "critical",
        page: sourcePage,
        message: `Broken ${kind}: ${ref.url} (${reason})`,
        recommendation: `Fix or remove this ${kind} — it currently ${reason === "" ? "doesn't resolve" : reason}.`,
      });
    }
  });

  return findings;
}
