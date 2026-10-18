import { parseCsvRows } from "@/lib/csvParsing";
import { normalizeSku } from "@/lib/skuMatch";

export type CsvFilterMode = "include" | "exclude";

/** A first-row value that's clearly a column title, not a SKU. */
const HEADER_PATTERN = /^(product\s*|variant\s*)?skus?$/i;

/**
 * Reads the SKUs out of a one-column CSV: the first cell of every row,
 * trimmed, blanks dropped, and the first row skipped when it's just a
 * "SKU" column title. Extra columns, if there are any, are ignored.
 */
export function parseSkuColumn(text: string): string[] {
  const rows = parseCsvRows(text);
  const skus: string[] = [];
  rows.forEach((row, index) => {
    const value = (row[0] ?? "").trim();
    if (!value) return;
    if (index === 0 && HEADER_PATTERN.test(value)) return;
    skus.push(value);
  });
  return skus;
}

export interface FolderSplit {
  /** Folders that will be scanned and uploaded. */
  eligible: string[];
  /** Folders the CSV filter leaves out. */
  skipped: string[];
  /** Folders whose SKU appears in the CSV, whichever mode is on. */
  inCsv: number;
  /** CSV SKUs that have no folder in the zip. */
  csvWithoutFolder: number;
}

/**
 * Include: only folders whose SKU is in the CSV are used. Exclude: folders
 * whose SKU is in the CSV are left out. With no CSV loaded, every folder is used.
 */
export function splitFoldersByCsv(folderSkus: string[], csvSkus: string[] | null, mode: CsvFilterMode, ignoreCase: boolean): FolderSplit {
  if (!csvSkus) return { eligible: [...folderSkus], skipped: [], inCsv: 0, csvWithoutFolder: 0 };

  const csvKeys = new Set(csvSkus.map((s) => normalizeSku(s, ignoreCase)));
  const folderKeys = new Set(folderSkus.map((s) => normalizeSku(s, ignoreCase)));
  const eligible: string[] = [];
  const skipped: string[] = [];
  let inCsv = 0;

  for (const sku of folderSkus) {
    const isInCsv = csvKeys.has(normalizeSku(sku, ignoreCase));
    if (isInCsv) inCsv += 1;
    const use = mode === "include" ? isInCsv : !isInCsv;
    (use ? eligible : skipped).push(sku);
  }

  let csvWithoutFolder = 0;
  for (const key of csvKeys) if (!folderKeys.has(key)) csvWithoutFolder += 1;
  return { eligible, skipped, inCsv, csvWithoutFolder };
}
