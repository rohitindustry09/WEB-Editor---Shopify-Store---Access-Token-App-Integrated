import "server-only";
import * as cheerio from "cheerio";
import type { ParsedPage } from "./types";

/**
 * Extracts everything the check modules need from one page's raw HTML.
 * Parse-only — `cheerio.load` never touches the network itself (unlike
 * cheerio's own `fromURL` convenience, which this deliberately avoids); the
 * HTML always arrives here already fetched through `safeFetch`.
 */
export function parsePageHtml(url: string, status: number, html: string): ParsedPage {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const h1s = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const headingCounts: Record<string, number> = {};
  for (const level of ["h2", "h3", "h4", "h5", "h6"]) {
    headingCounts[level] = $(level).length;
  }

  const images = $("img")
    .map((_, el) => ({ src: $(el).attr("src") ?? "", alt: $(el).attr("alt") ?? null }))
    .get()
    .filter((img) => img.src.length > 0);

  const links = $("a[href]")
    .map((_, el) => ({ href: $(el).attr("href") ?? "", text: $(el).text().trim() }))
    .get()
    .filter((link) => link.href.length > 0);

  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const robotsMeta = $('meta[name="robots"]').attr("content")?.trim() || null;

  const jsonLdBlocks = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const favicon =
    $('link[rel="icon"]').attr("href")?.trim() ||
    $('link[rel="shortcut icon"]').attr("href")?.trim() ||
    $('link[rel="apple-touch-icon"]').attr("href")?.trim() ||
    null;

  const htmlLang = $("html").attr("lang")?.trim() || null;
  const viewport = $('meta[name="viewport"]').attr("content")?.trim() || null;
  const hreflangs = $("link[rel='alternate'][hreflang]")
    .map((_, el) => $(el).attr("hreflang") ?? "")
    .get()
    .filter(Boolean);

  // Script/style text isn't visible content — leaving it in would wreck both
  // the word count and the keyword density numbers with minified JS tokens.
  $("script, style, noscript").remove();
  const textContent = $("body").text().replace(/\s+/g, " ").trim();

  return {
    url,
    status,
    title,
    metaDescription,
    h1s,
    headingCounts,
    images,
    links,
    canonical,
    robotsMeta,
    jsonLdBlocks,
    favicon,
    htmlLang,
    viewport,
    hreflangs,
    textContent,
    htmlBytes: Buffer.byteLength(html, "utf-8"),
  };
}
