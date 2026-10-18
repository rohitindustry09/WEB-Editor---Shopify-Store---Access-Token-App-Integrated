import type { ProductStatus } from "@/lib/shopify/types";

/** One SKU value found in the connected store — a variant's own SKU, or a value read from a product metafield. */
export interface StoreSkuEntry {
  sku: string;
  productId: string;
  /** Null when the SKU came from a product-level metafield rather than a specific variant. */
  variantId: string | null;
  title: string;
  handle: string;
  status: ProductStatus;
  /** The product's featured image, when the lookup asked for it — only used for previews. */
  imageUrl?: string | null;
}

export interface CsvSkuRow {
  /** 1-based data row number (the header is row 0), for pointing a user at the exact line in their file. */
  rowNumber: number;
  sku: string;
  cells: string[];
}

export interface UpdateGroup {
  sku: string;
  rows: CsvSkuRow[];
  matches: StoreSkuEntry[];
  /** More than one distinct store product carries this SKU — an update here is ambiguous. */
  sharedByProducts: boolean;
}

export interface NewGroup {
  sku: string;
  rows: CsvSkuRow[];
}

export interface SkuMatchReport {
  csvRowCount: number;
  uniqueCsvSkuCount: number;
  update: UpdateGroup[];
  created: NewGroup[];
  /** CSV rows with an empty SKU cell — can't be matched, so they're neither new nor an update. */
  blankRows: CsvSkuRow[];
}

export function normalizeSku(value: string, ignoreCase: boolean): string {
  const trimmed = value.trim();
  return ignoreCase ? trimmed.toLowerCase() : trimmed;
}

const SKU_HEADER_PATTERN = /(^|[^a-z])sku([^a-z]|$)/i;

/** Best-guess SKU column: an exact "SKU"/"Variant SKU" header first, then any header containing "sku". */
export function suggestSkuColumn(headers: string[]): number {
  const exact = headers.findIndex((h) => /^(variant\s*)?sku$/i.test(h.trim()));
  if (exact >= 0) return exact;
  return headers.findIndex((h) => SKU_HEADER_PATTERN.test(h));
}

/** Turns parsed CSV rows (header first) into SKU-tagged rows for the chosen column. */
export function toCsvSkuRows(dataRows: string[][], skuColumn: number): CsvSkuRow[] {
  return dataRows.map((cells, index) => ({
    rowNumber: index + 1,
    sku: (cells[skuColumn] ?? "").trim(),
    cells,
  }));
}

export function matchSkus(rows: CsvSkuRow[], store: StoreSkuEntry[], ignoreCase: boolean): SkuMatchReport {
  const storeByKey = new Map<string, StoreSkuEntry[]>();
  for (const entry of store) {
    const key = normalizeSku(entry.sku, ignoreCase);
    if (!key) continue;
    const bucket = storeByKey.get(key);
    if (bucket) bucket.push(entry);
    else storeByKey.set(key, [entry]);
  }

  const blankRows: CsvSkuRow[] = [];
  const groups = new Map<string, { sku: string; rows: CsvSkuRow[] }>();
  for (const row of rows) {
    const key = normalizeSku(row.sku, ignoreCase);
    if (!key) {
      blankRows.push(row);
      continue;
    }
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { sku: row.sku, rows: [row] });
  }

  const update: UpdateGroup[] = [];
  const created: NewGroup[] = [];
  for (const [key, group] of groups) {
    const matches = storeByKey.get(key);
    if (matches) {
      update.push({
        sku: group.sku,
        rows: group.rows,
        matches,
        sharedByProducts: new Set(matches.map((m) => m.productId)).size > 1,
      });
    } else {
      created.push({ sku: group.sku, rows: group.rows });
    }
  }

  return { csvRowCount: rows.length, uniqueCsvSkuCount: groups.size, update, created, blankRows };
}
