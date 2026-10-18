import "server-only";
import type { Finding, ParsedPage } from "./types";

/** Pulls the `@type` value(s) out of a parsed JSON-LD object — handles both a single string and an array of types (both are valid schema.org shapes), and the common `@graph` wrapper some sites use to bundle several entities in one block. */
function extractTypes(node: unknown): string[] {
  if (node === null || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  const types: string[] = [];

  const typeValue = obj["@type"];
  if (typeof typeValue === "string") types.push(typeValue);
  else if (Array.isArray(typeValue)) types.push(...typeValue.filter((t): t is string => typeof t === "string"));

  if (Array.isArray(obj["@graph"])) {
    for (const entry of obj["@graph"]) types.push(...extractTypes(entry));
  }

  return types;
}

/** URL-path heuristic for "this looks like a product page" — deliberately approximate (a generic domain-agnostic tool has no other reliable signal without fetching and parsing full page text for price patterns), so this is only ever reported at "info" severity, never as a confident critical/warning claim. */
function looksLikeProductPage(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return /\/(products?|item|shop)\//.test(path);
}

/**
 * Validates any JSON-LD (`<script type="application/ld+json">`) found on
 * each page — that it actually parses as JSON and has a recognizable
 * `@type` — and, as a lower-confidence heuristic, flags pages whose URL
 * looks like a product page but carry no Product-typed schema at all.
 */
export function checkStructuredData(pages: ParsedPage[]): Finding[] {
  const findings: Finding[] = [];

  for (const page of pages) {
    const pageTypes: string[] = [];

    for (const block of page.jsonLdBlocks) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(block);
      } catch {
        findings.push({
          category: "structured-data",
          severity: "warning",
          page: page.url,
          message: "A JSON-LD structured data block on this page isn't valid JSON and will be ignored by search engines.",
          recommendation: "Fix the JSON syntax in the <script type=\"application/ld+json\"> block, or remove it if it's unused.",
        });
        continue;
      }

      const types = extractTypes(parsed);
      if (types.length === 0) {
        findings.push({
          category: "structured-data",
          severity: "info",
          page: page.url,
          message: "A JSON-LD block on this page has no recognizable @type.",
          recommendation: "Add an @type (e.g. \"Product\", \"Organization\", \"BreadcrumbList\") so search engines know what the structured data describes.",
        });
      }
      pageTypes.push(...types);
    }

    if (page.jsonLdBlocks.length === 0 && looksLikeProductPage(page.url)) {
      findings.push({
        category: "structured-data",
        severity: "info",
        page: page.url,
        message: "This page's URL looks like a product page, but no structured data was found.",
        recommendation: "Consider adding Product schema (price, availability, reviews) — it's what powers rich results like star ratings in search.",
      });
    } else if (pageTypes.length > 0 && looksLikeProductPage(page.url) && !pageTypes.includes("Product")) {
      findings.push({
        category: "structured-data",
        severity: "info",
        page: page.url,
        message: `This page's URL looks like a product page, but its structured data doesn't include a Product type (found: ${pageTypes.join(", ")}).`,
        recommendation: "If this is a product page, consider adding Product schema alongside what's already there.",
      });
    }
  }

  return findings;
}
