import "server-only";
import type { KeywordDensityEntry } from "./types";

/** Words too common to be meaningful in a density report — without this the top keywords on every site are "the", "and", "to". */
const STOP_WORDS = new Set([
  "the", "and", "for", "you", "your", "with", "this", "that", "from", "are", "our", "all", "can", "has",
  "have", "was", "were", "will", "not", "but", "his", "her", "its", "their", "them", "they", "then",
  "than", "out", "get", "got", "how", "why", "who", "what", "when", "where", "any", "every", "each",
  "more", "most", "some", "such", "only", "own", "same", "too", "very", "just", "also", "into", "over",
  "under", "about", "after", "before", "between", "during", "off", "once", "here", "there", "these",
  "those", "been", "being", "does", "did", "doing", "would", "could", "should", "shall", "may", "might",
]);

const MIN_WORD_LENGTH = 3;
const TOP_KEYWORDS = 15;

/**
 * Word-frequency analysis of a page's visible text — the same "keyword
 * density" view SEO tools show, computed locally from the page itself.
 * No external data needed: this is purely counting what's actually on the
 * page, not search volume (which would require a paid keyword database).
 */
export function analyzeKeywordDensity(text: string): { entries: KeywordDensityEntry[]; wordCount: number } {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const meaningful = words.filter((w) => w.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const counts = new Map<string, number>();
  for (const word of meaningful) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const total = words.length;
  const entries = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_KEYWORDS)
    .map(([keyword, instances]) => ({
      keyword,
      instances,
      density: total > 0 ? Number(((instances / total) * 100).toFixed(2)) : 0,
    }));

  return { entries, wordCount: total };
}
