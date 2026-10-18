import "server-only";
import type { AuditCategory, CategoryScore, Finding } from "./types";

/**
 * Penalty weight per finding severity. These are this tool's own weights,
 * chosen so a single critical issue moves the number meaningfully while a
 * handful of info notes barely does — deliberately NOT presented as, or
 * comparable to, any third-party score (Semrush's, Moz's, etc.), which are
 * proprietary formulas built on data this tool doesn't have.
 */
const SEVERITY_PENALTY = { critical: 25, warning: 8, info: 1 } as const;

const ALL_CATEGORIES: AuditCategory[] = [
  "on-page",
  "technical",
  "broken-links",
  "structured-data",
  "performance",
  "social",
];

/**
 * Penalties are averaged per page, not summed raw. Confirmed necessary
 * against a real 20-page store: the same issue repeated on every page (21
 * "images missing alt text" warnings, one per page) summed to a 105-point
 * penalty and pinned the category to a flat 0 — which says nothing about
 * whether the site is mildly or catastrophically bad. Dividing by the page
 * count makes the score mean "how bad is a typical page here", which is
 * both more useful and stable as the crawl size changes.
 */
function scoreFor(findings: Finding[], pageCount: number): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);
  const perPagePenalty = penalty / Math.max(1, pageCount);
  return Math.max(0, Math.min(100, Math.round(100 - perPagePenalty)));
}

export function computeScores(
  findings: Finding[],
  pageCount: number,
): { overallScore: number; categoryScores: CategoryScore[] } {
  const categoryScores: CategoryScore[] = ALL_CATEGORIES.map((category) => {
    const categoryFindings = findings.filter((f) => f.category === category);
    return {
      category,
      score: scoreFor(categoryFindings, pageCount),
      critical: categoryFindings.filter((f) => f.severity === "critical").length,
      warning: categoryFindings.filter((f) => f.severity === "warning").length,
      info: categoryFindings.filter((f) => f.severity === "info").length,
    };
  });

  // Overall is computed from ALL findings together, not as the average of
  // the six category scores. Averaging categories was measurably wrong on a
  // real store: four quiet categories sitting near 100 dragged the mean up
  // to 96 for a site that had 26 broken links — the two genuinely bad
  // categories got diluted into invisibility by the healthy ones.
  const overallScore = scoreFor(findings, pageCount);

  return { overallScore, categoryScores };
}
