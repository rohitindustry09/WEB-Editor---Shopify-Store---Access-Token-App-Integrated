// Deliberately has no `import "server-only"` guard, unlike the rest of
// this module family — these are plain constants (crawl size options, the
// audit's step list) that the client-side crawl dashboard needs too, so
// this file has to be safely importable from a "use client" component.

// Raised from the old fixed cap of 20 now that the crawl is a real
// breadth-first crawl (follows links found on every page it visits, not
// just the homepage) — a much larger site can actually be covered. Still
// bounded: an unbounded crawl of a real store (thousands of product/variant
// URLs) would never finish and would hammer the target site, so the UI
// lets the user pick a ceiling up to this hard limit.
export const MAX_PAGES_LIMIT = 500;
export const DEFAULT_MAX_PAGES = 150;
export const MAX_PAGES_OPTIONS = [50, 150, 300, 500] as const;

/** Every step this audit runs, in order — the live dashboard's timeline is driven directly off this list plus the `step-start`/`step-done` events emitted as each one runs. */
export const AUDIT_STEPS = [
  { id: "robots", label: "Reading robots.txt" },
  { id: "sitemap", label: "Discovering sitemap" },
  { id: "crawl", label: "Crawling pages" },
  { id: "on-page", label: "Analyzing on-page SEO" },
  { id: "structured-data", label: "Checking structured data" },
  { id: "technical", label: "Running technical checks" },
  { id: "links", label: "Checking links & images" },
  { id: "performance", label: "Measuring Core Web Vitals" },
  { id: "social", label: "Checking social presence" },
  { id: "scoring", label: "Scoring the audit" },
] as const;

export type AuditStepId = (typeof AUDIT_STEPS)[number]["id"];
