import type { CatalogRow } from "./types";

/** The catalog problems the Data health tool looks for. Pure functions, so the scan is instant once the catalog is loaded. */

export type IssueType =
  | "missingSku"
  | "duplicateSku"
  | "duplicateBarcode"
  | "noImage"
  | "zeroPrice"
  | "thinDescription"
  | "missingSeoTitle"
  | "missingSeoDescription"
  | "untracked"
  | "badCompareAt";

export interface IssueInfo {
  type: IssueType;
  label: string;
  /** Whether the issue belongs to the whole product (counted once per product) or to one variant. */
  scope: "product" | "variant";
  tone: "critical" | "caution" | "info";
  explain: string;
}

export const ISSUES: IssueInfo[] = [
  { type: "missingSku", label: "Missing SKU", scope: "variant", tone: "critical", explain: "Without a SKU, orders, stock imports and these tools can't match the variant." },
  { type: "duplicateSku", label: "Duplicate SKU", scope: "variant", tone: "critical", explain: "Two variants share one SKU, so updates by SKU hit the wrong one or both." },
  { type: "duplicateBarcode", label: "Duplicate barcode", scope: "variant", tone: "caution", explain: "Barcodes should be unique; shared ones break scanning and marketplace feeds." },
  { type: "noImage", label: "No image", scope: "product", tone: "critical", explain: "Products without an image convert badly and are rejected by most sales channels." },
  { type: "zeroPrice", label: "Price is 0", scope: "variant", tone: "critical", explain: "A zero price is almost always a mistake — it sells the item for free." },
  { type: "thinDescription", label: "Thin or empty description", scope: "product", tone: "caution", explain: "Under 30 characters of description hurts search ranking and buyer confidence." },
  { type: "missingSeoTitle", label: "No SEO title", scope: "product", tone: "info", explain: "Search results fall back to the product title; a tailored title ranks better." },
  { type: "missingSeoDescription", label: "No SEO description", scope: "product", tone: "info", explain: "Without one, search engines pick random text from the page." },
  { type: "untracked", label: "Inventory not tracked", scope: "variant", tone: "caution", explain: "Untracked variants never sell out, so they can oversell." },
  { type: "badCompareAt", label: "Compare-at not higher than price", scope: "variant", tone: "info", explain: "A compare-at price at or below the price shows no discount, or a confusing one." },
];

export interface HealthIssue {
  type: IssueType;
  row: CatalogRow;
}

const THIN_DESCRIPTION_CHARS = 30;
const SEO_TITLE_MAX = 70;
const SEO_DESCRIPTION_MAX = 155;

/** Rows keyed by lower-cased value, only values shared by at least two variants. */
function duplicatesOf(rows: CatalogRow[], pick: (row: CatalogRow) => string): Set<string> {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const value = pick(row).toLowerCase();
    if (value) seen.set(value, (seen.get(value) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([value]) => value));
}

/** Every issue found in the loaded catalog; product-level issues are reported once per product (on its first variant). */
export function analyzeCatalog(rows: CatalogRow[]): HealthIssue[] {
  const duplicateSkus = duplicatesOf(rows, (row) => row.sku);
  const duplicateBarcodes = duplicatesOf(rows, (row) => row.barcode);
  const issues: HealthIssue[] = [];
  const seenProducts = new Set<string>();

  for (const row of rows) {
    const add = (type: IssueType) => issues.push({ type, row });
    if (!row.sku) add("missingSku");
    else if (duplicateSkus.has(row.sku.toLowerCase())) add("duplicateSku");
    if (row.barcode && duplicateBarcodes.has(row.barcode.toLowerCase())) add("duplicateBarcode");
    if (Number(row.price) === 0) add("zeroPrice");
    if (!row.tracked) add("untracked");
    if (row.compareAtPrice !== null && Number(row.compareAtPrice) <= Number(row.price)) add("badCompareAt");

    if (seenProducts.has(row.productId)) continue;
    seenProducts.add(row.productId);
    if (row.imageCount === 0) add("noImage");
    if (row.descriptionText.trim().length < THIN_DESCRIPTION_CHARS) add("thinDescription");
    if (!row.seoTitle.trim()) add("missingSeoTitle");
    if (!row.seoDescription.trim()) add("missingSeoDescription");
  }
  return issues;
}

/** A suggested SEO title: the product title, cut to the length search engines show. */
export function suggestSeoTitle(row: Pick<CatalogRow, "productTitle">): string {
  return row.productTitle.trim().slice(0, SEO_TITLE_MAX);
}

/** A suggested SEO description from the product's own text (empty when there is none to use). */
export function suggestSeoDescription(row: Pick<CatalogRow, "descriptionText">): string {
  const text = row.descriptionText.replace(/\s+/g, " ").trim();
  if (text.length <= SEO_DESCRIPTION_MAX) return text;
  const cut = text.slice(0, SEO_DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}
