import "server-only";
import type { CrawlResult } from "./crawler";
import type { Finding, ParsedPage } from "./types";

interface RobotsGroup {
  agents: string[];
  disallows: string[];
}

/**
 * Groups a robots.txt into its `User-agent` blocks per the spec: one or
 * more consecutive `User-agent:` lines start a group, and every `Disallow:`
 * line until the next `User-agent:` line belongs to that group. A single
 * regex spanning "User-agent to the next Disallow" (an earlier version of
 * this check used exactly that) can match a `Disallow: /` that actually
 * belongs to a LATER, unrelated user-agent block — a false positive on
 * what's reported here as a critical, "your whole site is blocked" finding,
 * so it's worth actually parsing the block structure instead of guessing.
 */
function parseRobotsGroups(robotsTxt: string): RobotsGroup[] {
  const lines = robotsTxt
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);

  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "user-agent") {
      // A User-agent line after this group already has rules starts a new
      // group; consecutive User-agent lines (no rules between them yet)
      // belong to the same group, per the spec.
      if (current && current.disallows.length > 0) {
        groups.push(current);
        current = { agents: [value], disallows: [] };
      } else if (current) {
        current.agents.push(value);
      } else {
        current = { agents: [value], disallows: [] };
      }
    } else if (key === "disallow" && current) {
      current.disallows.push(value);
    }
  }
  if (current) groups.push(current);

  return groups;
}

function robotsBlocksEverything(robotsTxt: string): boolean {
  const wildcardGroups = parseRobotsGroups(robotsTxt).filter((g) => g.agents.includes("*"));
  return wildcardGroups.some((g) => g.disallows.includes("/"));
}

/** Site-level checks (sitemap, robots.txt) that apply to the whole audit rather than one page — reported against the homepage URL since that's the natural place to go looking. */
export function checkSiteTechnicals(crawl: CrawlResult, homepageUrl: string): Finding[] {
  const findings: Finding[] = [];

  if (!crawl.usedSitemap) {
    findings.push({
      category: "technical",
      severity: "warning",
      page: homepageUrl,
      message: "No sitemap.xml found (or it didn't list any pages).",
      recommendation: "Add a sitemap.xml listing your important pages — it helps search engines discover and prioritize content, and this audit fell back to following links instead of using it.",
    });
  }

  if (!crawl.robotsTxtFound) {
    findings.push({
      category: "technical",
      severity: "info",
      page: homepageUrl,
      message: "No robots.txt found.",
      recommendation: "A robots.txt isn't strictly required, but it's the standard place to point crawlers at your sitemap and control which paths they should skip.",
    });
  } else if (crawl.robotsTxtBody && robotsBlocksEverything(crawl.robotsTxtBody)) {
    findings.push({
      category: "technical",
      severity: "critical",
      page: homepageUrl,
      message: "robots.txt appears to block all crawlers from the entire site (Disallow: / under User-agent: *).",
      recommendation: "If this is intentional (e.g. a staging site), fine — otherwise this is very likely preventing the site from being indexed at all.",
    });
  }

  return findings;
}

/** Per-page technical checks derived straight from that page's parsed HTML. */
export function checkPageTechnicals(page: ParsedPage): Finding[] {
  const findings: Finding[] = [];

  if (!page.url.startsWith("https://")) {
    findings.push({
      category: "technical",
      severity: "critical",
      page: page.url,
      message: "Page is served over plain HTTP, not HTTPS.",
      recommendation: "Serve the site over HTTPS — it's both a ranking factor and required for most modern browser features.",
    });
  }

  if (page.robotsMeta && /noindex/i.test(page.robotsMeta)) {
    findings.push({
      category: "technical",
      severity: "critical",
      page: page.url,
      message: `Page has a noindex directive (<meta name="robots" content="${page.robotsMeta}">).`,
      recommendation: "If this page is meant to appear in search results, remove the noindex directive — right now it's explicitly telling search engines not to index it.",
    });
  }

  if (page.canonical) {
    try {
      const canonicalUrl = new URL(page.canonical, page.url);
      const pageUrl = new URL(page.url);
      if (canonicalUrl.origin !== pageUrl.origin) {
        findings.push({
          category: "technical",
          severity: "warning",
          page: page.url,
          message: `Canonical tag points to a different domain (${canonicalUrl.origin}).`,
          recommendation: "Double-check this is intentional — an off-domain canonical tells search engines the authoritative version of this page lives elsewhere, which usually isn't what's wanted.",
        });
      }
    } catch {
      findings.push({
        category: "technical",
        severity: "warning",
        page: page.url,
        message: `Canonical tag has an unparsable URL: "${page.canonical}"`,
        recommendation: "Fix the canonical tag's href so it's a valid, absolute URL.",
      });
    }
  } else {
    findings.push({
      category: "technical",
      severity: "info",
      page: page.url,
      message: "No canonical tag found.",
      recommendation: "Add a self-referencing canonical tag — it helps prevent duplicate-content issues if the page is ever reachable via more than one URL.",
    });
  }

  if (!page.favicon) {
    findings.push({
      category: "technical",
      severity: "info",
      page: page.url,
      message: "No favicon declared.",
      recommendation: "Add a favicon link — it shows in browser tabs and search results, and its absence reads as an unfinished site.",
    });
  }

  if (!page.htmlLang) {
    findings.push({
      category: "technical",
      severity: "warning",
      page: page.url,
      message: "No lang attribute on the <html> element.",
      recommendation: 'Add one (e.g. <html lang="en">) so search engines and screen readers know what language the page is in.',
    });
  }

  if (!page.viewport) {
    findings.push({
      category: "technical",
      severity: "critical",
      page: page.url,
      message: "No viewport meta tag — the page won't render correctly on mobile.",
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> — Google indexes mobile-first, so this affects rankings directly, not just appearance.',
    });
  }

  return findings;
}
