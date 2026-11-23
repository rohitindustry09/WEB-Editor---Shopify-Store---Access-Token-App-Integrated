import "server-only";
import { crawlSite, type CrawlEvent } from "./crawler";
import { checkOnPage } from "./onPageChecks";
import { checkSiteTechnicals, checkPageTechnicals } from "./technicalChecks";
import { checkStructuredData } from "./structuredData";
import { checkLinks } from "./linkChecker";
import { fetchPerformance, checkPerformance } from "./performance";
import { checkSocialPresence } from "./socialChecks";
import { analyzeKeywordDensity } from "./keywordDensity";
import { computeScores } from "./scoring";
import { DEFAULT_MAX_PAGES, MAX_PAGES_LIMIT, type AuditStepId } from "./constants";
import type { AuditCategory, Severity, SeoAuditReport, LiveStoreInfo } from "./types";

export class InvalidDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDomainError";
  }
}

/** Accepts either a bare domain ("example.com") or a full URL, defaults to https, and rejects anything that doesn't look like a real domain before any network call happens. */
function normalizeDomainInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new InvalidDomainError("Enter a domain to audit.");

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidDomainError(`"${input}" doesn't look like a valid domain.`);
  }
  if (!url.hostname.includes(".")) {
    throw new InvalidDomainError(`"${input}" doesn't look like a valid domain.`);
  }
  return url.origin;
}

export type AuditEvent =
  | CrawlEvent
  | { type: "step-start"; id: AuditStepId }
  | { type: "step-done"; id: AuditStepId; detail?: string }
  | { type: "live-store"; total: number; counts: LiveStoreInfo["counts"]; errors: string[] }
  | { type: "fatal-error"; message: string };

export type EmitAuditEvent = (event: AuditEvent) => void;

const PAGE_TITLE_LIMIT = 200;

/**
 * Runs the full audit, emitting an `AuditEvent` for every step and every
 * crawled page along the way — the UI reads this stream live instead of
 * waiting on one big response. Crawling and fetching now happen together
 * inside `crawlSite` (a real breadth-first crawl, not just a sitemap read),
 * so this function's own job is running every check module over whatever
 * `crawlSite` found and aggregating the results into one report.
 */
export async function runStreamingAudit(domainInput: string, onEvent: EmitAuditEvent, maxPages: number = DEFAULT_MAX_PAGES, liveStore: LiveStoreInfo | null = null, workers = 0, mode: "resume" | "fresh" = "fresh"): Promise<SeoAuditReport> {
  // On the connected store the primary domain is the real address, whatever was typed (e.g. the .myshopify.com one).
  const origin = liveStore ? normalizeDomainInput(liveStore.primaryDomain) : normalizeDomainInput(domainInput);
  if (liveStore) onEvent({ type: "live-store", total: liveStore.total, counts: liveStore.counts, errors: liveStore.errors });
  const cap = maxPages === 0 ? (liveStore ? Math.max(liveStore.total, 1) : MAX_PAGES_LIMIT) : maxPages;

  onEvent({ type: "step-start", id: "robots" });
  // "robots" and "sitemap" both complete inside crawlSite's discovery phase
  // — their own CrawlEvents (robots-checked / sitemap-checked) double as
  // this step's completion signal, forwarded straight through below.
  const { crawl, parsedPages, findings } = await crawlSite(origin, cap, (event) => {
    onEvent(event);
    if (event.type === "robots-checked") onEvent({ type: "step-done", id: "robots" });
    if (event.type === "sitemap-checked") {
      onEvent({ type: "step-done", id: "sitemap", detail: event.found ? `${event.pageCount} URLs` : undefined });
      onEvent({ type: "step-start", id: "crawl" });
    }
  }, liveStore?.urls ?? [], workers, mode);
  onEvent({ type: "step-done", id: "crawl", detail: `${crawl.pages.length} pages` });

  // The sitemap's own <loc> ordering (or link-discovery order) has no
  // relationship to which page is actually the homepage — the homepage is
  // whichever successfully-parsed HTML page's URL matches the site's root,
  // or failing that, just the first HTML page this audit actually managed
  // to fetch.
  const rootUrl = new URL(origin).toString();
  const homepageUrl = parsedPages.find((p) => p.url === rootUrl || p.url === origin)?.url ?? parsedPages[0]?.url ?? origin;

  onEvent({ type: "step-start", id: "on-page" });
  findings.push(...checkSiteTechnicals(crawl, homepageUrl));
  findings.push(...checkOnPage(parsedPages));
  onEvent({ type: "step-done", id: "on-page" });

  onEvent({ type: "step-start", id: "structured-data" });
  findings.push(...checkStructuredData(parsedPages));
  onEvent({ type: "step-done", id: "structured-data" });

  onEvent({ type: "step-start", id: "technical" });
  for (const page of parsedPages) findings.push(...checkPageTechnicals(page));
  onEvent({ type: "step-done", id: "technical" });

  // Core Web Vitals and the link check are the two slow parts — running
  // them together rather than one after the other keeps a full audit from
  // taking the sum of both.
  onEvent({ type: "step-start", id: "links" });
  onEvent({ type: "step-start", id: "performance" });
  const [linkFindings, performance] = await Promise.all([checkLinks(parsedPages), fetchPerformance(homepageUrl)]);
  findings.push(...linkFindings);
  findings.push(...checkPerformance(performance, homepageUrl));
  onEvent({ type: "step-done", id: "links" });
  onEvent({ type: "step-done", id: "performance" });

  onEvent({ type: "step-start", id: "social" });
  const { presence, findings: socialFindings } = checkSocialPresence(parsedPages, homepageUrl);
  findings.push(...socialFindings);
  onEvent({ type: "step-done", id: "social" });

  // Keyword density and word count describe the homepage specifically —
  // averaging them across every crawled page would produce a number that
  // describes no actual page.
  const homepage = parsedPages.find((p) => p.url === homepageUrl) ?? parsedPages[0];
  const { entries: keywordDensity, wordCount: homepageWordCount } = homepage
    ? analyzeKeywordDensity(homepage.textContent)
    : { entries: [], wordCount: 0 };

  if (homepage && homepageWordCount < 300) {
    findings.push({
      category: "on-page",
      severity: "warning",
      page: homepage.url,
      message: `Thin content: only ${homepageWordCount} words of visible text on this page.`,
      recommendation: "Pages with very little text give search engines almost nothing to rank — aim for genuinely useful content, not filler.",
    });
  }

  onEvent({ type: "step-start", id: "scoring" });
  const categoryCounts: Record<AuditCategory, number> = {
    "on-page": 0,
    technical: 0,
    "broken-links": 0,
    "structured-data": 0,
    performance: 0,
    social: 0,
  };
  const severityCounts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  for (const finding of findings) {
    categoryCounts[finding.category]++;
    severityCounts[finding.severity]++;
  }

  const { overallScore, categoryScores } = computeScores(findings, crawl.pages.length);

  const pageTitles: Record<string, string | null> = {};
  for (const page of parsedPages) pageTitles[page.url] = page.title?.slice(0, PAGE_TITLE_LIMIT) ?? null;
  onEvent({ type: "step-done", id: "scoring" });

  return {
    domain: origin,
    liveStore: liveStore ? { primaryDomain: liveStore.primaryDomain, host: liveStore.host, shop: liveStore.shop, counts: liveStore.counts, total: liveStore.total, errors: liveStore.errors } : undefined,
    pagesCrawled: crawl.pages,
    pageTitles,
    usedSitemap: crawl.usedSitemap,
    findings,
    categoryCounts,
    severityCounts,
    overallScore,
    categoryScores,
    performance,
    social: presence,
    keywordDensity,
    homepageWordCount,
    generatedAt: new Date().toISOString(),
  };
}
