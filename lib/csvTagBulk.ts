import { parseCsvRows } from "./csvParsing";

export interface TagBulkCsvRow {
  /** Whatever was in column 1 — a SKU or a title, depending on the "Match by SKU" toggle. */
  identifier: string;
  tags: string[];
}

export interface SkippedCsvRow {
  /** 1-based line number in the file, so it lines up with what a spreadsheet shows. */
  lineNumber: number;
  raw: string;
  reason: "no-identifier" | "no-tags";
}

export interface TagBulkCsvParseResult {
  rows: TagBulkCsvRow[];
  /** Raw data lines actually read (header and blank lines excluded) — kept separate from `rows.length` so merging same-identifier rows together never looks like rows went missing. */
  totalRowsRead: number;
  /** Rows that had no column-1 value, or no tags left after parsing — surfaced instead of silently vanishing, since a row can legitimately have empty tags in a messy source file (e.g. tag text pasted into the title cell by mistake). */
  skippedRows: SkippedCsvRow[];
}

/**
 * Parses a (Title or SKU, tags…) CSV. Column 1 is the identifier; everything
 * after it is treated as tags — whether that's one quoted cell containing
 * "tag1, tag2, tag3" or several unquoted columns, both end up as the same
 * flat tag list. Multiple rows for the same identifier merge their tags,
 * which is why `rows.length` can legitimately be smaller than the CSV's own
 * line count — `totalRowsRead` reports the raw count so that's visible
 * rather than looking like rows silently vanished.
 */
export function parseTagBulkCsv(text: string): TagBulkCsvParseResult {
  const allRows = parseCsvRows(text);
  const byIdentifier = new Map<string, string[]>();
  const skippedRows: SkippedCsvRow[] = [];
  let totalRowsRead = 0;

  for (let i = 0; i < allRows.length; i++) {
    const cells = allRows[i];
    // A rough, human-readable stand-in for the original line — parseCsvRows
    // hands back parsed cells, not the raw source text, and a skipped row's
    // exact original punctuation doesn't matter for this preview.
    const raw = cells.join(", ");
    if (i === 0 && /^(title|sku)$/i.test(cells[0] ?? "") && /tag/i.test(cells.slice(1).join(" "))) continue;

    const identifier = cells[0];
    if (!identifier) {
      skippedRows.push({ lineNumber: i + 1, raw, reason: "no-identifier" });
      continue;
    }

    const tags = cells
      .slice(1)
      .join(",")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      skippedRows.push({ lineNumber: i + 1, raw, reason: "no-tags" });
      continue;
    }

    totalRowsRead++;
    const existing = byIdentifier.get(identifier) ?? [];
    for (const tag of tags) {
      if (!existing.some((t) => t.toLowerCase() === tag.toLowerCase())) existing.push(tag);
    }
    byIdentifier.set(identifier, existing);
  }

  const rows = Array.from(byIdentifier.entries()).map(([identifier, tags]) => ({ identifier, tags }));
  return { rows, totalRowsRead, skippedRows };
}
