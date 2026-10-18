import "server-only";
import type { Finding, ParsedPage } from "./types";

const TITLE_MIN_LEN = 30;
const TITLE_MAX_LEN = 60;
const DESCRIPTION_MIN_LEN = 70;
const DESCRIPTION_MAX_LEN = 160;

/** Groups page URLs by a lowercased field value, so duplicate titles/descriptions across pages can be reported — every page's finding names the OTHER pages sharing the same text, not just an abstract "duplicates exist somewhere" statement. */
function findDuplicates(pages: ParsedPage[], getValue: (p: ParsedPage) => string | null): Map<string, string[]> {
  const byValue = new Map<string, string[]>();
  for (const page of pages) {
    const value = getValue(page)?.trim().toLowerCase();
    if (!value) continue;
    const urls = byValue.get(value) ?? [];
    urls.push(page.url);
    byValue.set(value, urls);
  }
  const duplicatesOnly = new Map<string, string[]>();
  for (const [value, urls] of byValue) {
    if (urls.length > 1) duplicatesOnly.set(value, urls);
  }
  return duplicatesOnly;
}

/**
 * The classic on-page checklist: title tag presence/length/duplication,
 * meta description presence/length/duplication, H1 structure, and image
 * alt-text coverage. Runs across every crawled page at once (rather than
 * one page in isolation) specifically so duplicate titles/descriptions —
 * only detectable by comparing pages against each other — get caught.
 */
export function checkOnPage(pages: ParsedPage[]): Finding[] {
  const findings: Finding[] = [];
  const duplicateTitles = findDuplicates(pages, (p) => p.title);
  const duplicateDescriptions = findDuplicates(pages, (p) => p.metaDescription);

  for (const page of pages) {
    if (!page.title) {
      findings.push({
        category: "on-page",
        severity: "critical",
        page: page.url,
        message: "Missing <title> tag.",
        recommendation: "Add a unique, descriptive title tag — aim for roughly 30–60 characters.",
      });
    } else {
      if (page.title.length < TITLE_MIN_LEN) {
        findings.push({
          category: "on-page",
          severity: "warning",
          page: page.url,
          message: `Title is short (${page.title.length} characters): "${page.title}"`,
          recommendation: `Expand the title toward ${TITLE_MIN_LEN}-${TITLE_MAX_LEN} characters so it makes full use of search result space.`,
        });
      } else if (page.title.length > TITLE_MAX_LEN) {
        findings.push({
          category: "on-page",
          severity: "warning",
          page: page.url,
          message: `Title is long (${page.title.length} characters) and will likely be truncated in search results: "${page.title}"`,
          recommendation: `Shorten the title toward ${TITLE_MIN_LEN}-${TITLE_MAX_LEN} characters, keeping the most important words first.`,
        });
      }
      const dupeGroup = duplicateTitles.get(page.title.trim().toLowerCase());
      if (dupeGroup) {
        const others = dupeGroup.filter((url) => url !== page.url);
        findings.push({
          category: "on-page",
          severity: "warning",
          page: page.url,
          message: `Title is duplicated on ${others.length} other page${others.length === 1 ? "" : "s"}: ${others.join(", ")}`,
          recommendation: "Give each page its own unique title so search engines can tell them apart.",
        });
      }
    }

    if (!page.metaDescription) {
      findings.push({
        category: "on-page",
        severity: "critical",
        page: page.url,
        message: "Missing meta description.",
        recommendation: `Add a meta description summarizing the page — aim for roughly ${DESCRIPTION_MIN_LEN}-${DESCRIPTION_MAX_LEN} characters.`,
      });
    } else {
      if (page.metaDescription.length < DESCRIPTION_MIN_LEN) {
        findings.push({
          category: "on-page",
          severity: "info",
          page: page.url,
          message: `Meta description is short (${page.metaDescription.length} characters).`,
          recommendation: `Expand it toward ${DESCRIPTION_MIN_LEN}-${DESCRIPTION_MAX_LEN} characters to better fill the search result snippet.`,
        });
      } else if (page.metaDescription.length > DESCRIPTION_MAX_LEN) {
        findings.push({
          category: "on-page",
          severity: "info",
          page: page.url,
          message: `Meta description is long (${page.metaDescription.length} characters) and will likely be truncated.`,
          recommendation: `Shorten it toward ${DESCRIPTION_MIN_LEN}-${DESCRIPTION_MAX_LEN} characters, keeping the key message first.`,
        });
      }
      const dupeGroup = duplicateDescriptions.get(page.metaDescription.trim().toLowerCase());
      if (dupeGroup) {
        const others = dupeGroup.filter((url) => url !== page.url);
        findings.push({
          category: "on-page",
          severity: "warning",
          page: page.url,
          message: `Meta description is duplicated on ${others.length} other page${others.length === 1 ? "" : "s"}: ${others.join(", ")}`,
          recommendation: "Write a distinct meta description for each page.",
        });
      }
    }

    if (page.h1s.length === 0) {
      findings.push({
        category: "on-page",
        severity: "warning",
        page: page.url,
        message: "No <h1> heading found.",
        recommendation: "Add a single, descriptive <h1> that states what the page is about.",
      });
    } else if (page.h1s.length > 1) {
      findings.push({
        category: "on-page",
        severity: "info",
        page: page.url,
        message: `${page.h1s.length} <h1> headings found — usually a page should have exactly one.`,
        recommendation: "Keep one <h1> per page and use <h2>/<h3> for the rest of the heading structure.",
      });
    }

    const missingAlt = page.images.filter((img) => !img.alt || img.alt.trim() === "");
    if (missingAlt.length > 0) {
      findings.push({
        category: "on-page",
        severity: "warning",
        page: page.url,
        message: `${missingAlt.length} of ${page.images.length} image${page.images.length === 1 ? "" : "s"} missing alt text.`,
        recommendation: "Add descriptive alt text to every meaningful image — it helps both accessibility and image search.",
      });
    }
  }

  return findings;
}
