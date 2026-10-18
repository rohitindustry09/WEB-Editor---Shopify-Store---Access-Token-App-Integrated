import { parseCsvRows } from "./csvParsing";

/** The Shopify fields this tool is able to write. Order here is the order shown in the mapping UI. */
export type UpdatableField = "title" | "descriptionHtml" | "tags" | "seoTitle" | "seoDescription";

export interface UpdatableFieldDef {
  key: UpdatableField;
  label: string;
  /** Column headers matching this get auto-suggested as the source for this field. */
  pattern: RegExp;
}

export const UPDATABLE_FIELDS: UpdatableFieldDef[] = [
  { key: "title", label: "Product Title", pattern: /^(title|product[\s_-]*title|product[\s_-]*name|name)$/i },
  {
    key: "descriptionHtml",
    label: "Description",
    pattern: /^(description|body([\s_-]*html)?|product[\s_-]*description|desc)$/i,
  },
  { key: "tags", label: "Tags", pattern: /^tags?$/i },
  { key: "seoTitle", label: "Meta Title", pattern: /^(meta[\s_-]*title|seo[\s_-]*title)$/i },
  { key: "seoDescription", label: "Meta Description", pattern: /^(meta[\s_-]*description|seo[\s_-]*description)$/i },
];

/** Column headers matching this get auto-suggested as the SKU (row identifier) column. */
const SKU_HEADER_PATTERN = /^(sku|variant[\s_-]*sku|product[\s_-]*sku|sku[\s_-]*id)$/i;

export interface ProductContentCsvRow {
  /** 1-based line number in the file, so it lines up with what a spreadsheet shows. */
  lineNumber: number;
  /** Header → raw cell value, for this row only. */
  cells: Record<string, string>;
}

export interface ProductContentCsvParseResult {
  headers: string[];
  rows: ProductContentCsvRow[];
  /** Best-guess header for the SKU column, or null if nothing matched — the user picks explicitly either way. */
  suggestedSkuColumn: string | null;
  /** Best-guess header per updatable field, wherever a column name matched. */
  suggestedFieldColumns: Partial<Record<UpdatableField, string>>;
}

/**
 * Parses a generic (Title/SKU/Description/... in any order, any column set)
 * CSV into headers + raw per-row cell values. Unlike the tag-bulk parser,
 * this one doesn't know yet which column is the SKU or which columns map to
 * which Shopify field — that mapping is a user choice made after upload, so
 * this only reads the file and offers best-guess suggestions for it.
 */
export function parseProductContentCsv(text: string): ProductContentCsvParseResult {
  const allRows = parseCsvRows(text);
  if (allRows.length === 0) {
    return { headers: [], rows: [], suggestedSkuColumn: null, suggestedFieldColumns: {} };
  }

  const headers = allRows[0];
  const rows: ProductContentCsvRow[] = [];
  for (let i = 1; i < allRows.length; i++) {
    const cellValues = allRows[i];
    const cells: Record<string, string> = {};
    headers.forEach((header, index) => {
      cells[header] = cellValues[index] ?? "";
    });
    rows.push({ lineNumber: i + 1, cells });
  }

  const suggestedSkuColumn = headers.find((h) => SKU_HEADER_PATTERN.test(h.trim())) ?? null;
  const suggestedFieldColumns: Partial<Record<UpdatableField, string>> = {};
  for (const field of UPDATABLE_FIELDS) {
    const match = headers.find((h) => field.pattern.test(h.trim()));
    if (match) suggestedFieldColumns[field.key] = match;
  }

  return { headers, rows, suggestedSkuColumn, suggestedFieldColumns };
}

export interface MappedProductContentRow {
  lineNumber: number;
  sku: string;
  /** Only the fields the user actually mapped + enabled, with this row's value for each. */
  fields: Partial<Record<UpdatableField, string>>;
}

export interface MappedProductContentResult {
  rows: MappedProductContentRow[];
  /** Rows with no value in the chosen SKU column — surfaced rather than silently dropped. */
  skippedNoSku: number[];
  /** Rows where every mapped field came back empty — nothing to write, so surfaced instead of sent as a no-op update. */
  skippedNoValues: number[];
}

/**
 * Applies the user's chosen SKU column + field mapping to every parsed row,
 * producing the flat (sku, fields) shape the lookup/apply pipeline works
 * with. Kept separate from parsing so re-mapping (changing which column
 * feeds which field) never requires re-reading the file.
 */
/**
 * Strips a leading run of dots and whitespace from a cell value — a common
 * artifact of templated spreadsheet formulas like `="Brand. "&B2`, where an
 * empty brand cell leaves the literal ". " prefix behind (e.g. a real cell
 * seen in practice: ". Misty Teal Nail Polish 10ml | Nail Paint"). Only the
 * leading edge is touched; a value that's supposed to contain a period
 * anywhere else is untouched.
 */
function stripLeadingArtifacts(value: string): string {
  return value.replace(/^[\s.]+/, "");
}

export function mapProductContentRows(
  rows: ProductContentCsvRow[],
  skuColumn: string,
  fieldMapping: Partial<Record<UpdatableField, string>>,
): MappedProductContentResult {
  const mapped: MappedProductContentRow[] = [];
  const skippedNoSku: number[] = [];
  const skippedNoValues: number[] = [];
  const activeFields = (Object.entries(fieldMapping) as [UpdatableField, string | undefined][]).filter(
    (entry): entry is [UpdatableField, string] => Boolean(entry[1]),
  );

  for (const row of rows) {
    const sku = (row.cells[skuColumn] ?? "").trim();
    if (!sku) {
      skippedNoSku.push(row.lineNumber);
      continue;
    }

    const fields: Partial<Record<UpdatableField, string>> = {};
    for (const [fieldKey, column] of activeFields) {
      const raw = row.cells[column];
      if (raw === undefined) continue;
      const cleaned = stripLeadingArtifacts(raw.trim());
      if (cleaned !== "") fields[fieldKey] = cleaned;
    }

    if (Object.keys(fields).length === 0) {
      skippedNoValues.push(row.lineNumber);
      continue;
    }

    mapped.push({ lineNumber: row.lineNumber, sku, fields });
  }

  return { rows: mapped, skippedNoSku, skippedNoValues };
}
