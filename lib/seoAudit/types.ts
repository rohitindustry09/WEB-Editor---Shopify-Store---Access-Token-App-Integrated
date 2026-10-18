export type Severity = "critical" | "warning" | "info";
export type AuditCategory =
  | "on-page"
  | "technical"
  | "broken-links"
  | "structured-data"
  | "performance"
  | "social";

export interface Finding {
  category: AuditCategory;
  severity: Severity;
  /** The page this finding applies to — always a concrete URL, never a vague category-level statement. */
  page: string;
  message: string;
  recommendation: string;
}

export interface ParsedImage {
  src: string;
  alt: string | null;
}

export interface ParsedLink {
  href: string;
  text: string;
}

/** Everything pulled out of one crawled page's HTML — the shape every check module reads from. */
export interface ParsedPage {
  url: string;
  status: number;
  title: string | null;
  metaDescription: string | null;
  h1s: string[];
  /** Counts for h2–h6, for the heading-structure overview. */
  headingCounts: Record<string, number>;
  images: ParsedImage[];
  links: ParsedLink[];
  canonical: string | null;
  robotsMeta: string | null;
  /** Raw text content of every `<script type="application/ld+json">` block found. */
  jsonLdBlocks: string[];
  favicon: string | null;
  /** The `lang` attribute on `<html>`, if declared. */
  htmlLang: string | null;
  viewport: string | null;
  hreflangs: string[];
  /** Visible text content, used for word count / keyword density. */
  textContent: string;
  /** Size of the raw HTML in bytes — a rough page-weight signal. */
  htmlBytes: number;
}

export interface KeywordDensityEntry {
  keyword: string;
  instances: number;
  /** Percentage of total words. */
  density: number;
}

export type PerformanceStrategy = "mobile" | "desktop";

export interface PerformanceMetrics {
  strategy: PerformanceStrategy;
  /** Lighthouse performance score, 0-100. */
  performanceScore: number | null;
  /** Largest Contentful Paint, seconds. */
  lcpSeconds: number | null;
  /** Cumulative Layout Shift, unitless. */
  cls: number | null;
  /** Interaction to Next Paint, milliseconds (field data; absent for low-traffic sites). */
  inpMs: number | null;
  /** First Contentful Paint, seconds. */
  fcpSeconds: number | null;
  /** Total Blocking Time, milliseconds. */
  tbtMs: number | null;
  /** Set when the API couldn't be reached or returned an error — the report says so rather than showing blanks as if they were real zeros. */
  error: string | null;
}

export interface SocialPresence {
  platform: string;
  url: string | null;
}

export interface CategoryScore {
  category: AuditCategory;
  /** 0-100. */
  score: number;
  critical: number;
  warning: number;
  info: number;
}

export interface SeoAuditReport {
  domain: string;
  pagesCrawled: string[];
  /** Each crawled page's own <title>, keyed by URL — null for a page that had none, absent for a URL that wasn't successfully parsed as HTML (a fetch failure or a non-HTML sitemap entry). Lets the UI show a real page name instead of just the URL. */
  pageTitles: Record<string, string | null>;
  usedSitemap: boolean;
  findings: Finding[];
  categoryCounts: Record<AuditCategory, number>;
  severityCounts: Record<Severity, number>;
  /** Overall 0-100 health score computed from the findings below — this tool's own formula, not a third-party metric. */
  overallScore: number;
  categoryScores: CategoryScore[];
  performance: PerformanceMetrics | null;
  social: SocialPresence[];
  keywordDensity: KeywordDensityEntry[];
  /** Total visible words on the homepage — a content-depth signal. */
  homepageWordCount: number;
  generatedAt: string;
}
