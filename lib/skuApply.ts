import { htmlToRichText, isEmptyRichText, plainTextToRichText, type RichTextFormat } from "./richText";

/** Fields the Upload & Update tool can write from a CSV column, grouped the way Shopify's own product page groups them. */
export const APPLY_FIELDS = [
  { key: "title", group: "product", label: "Title", hint: "Required to create new products" },
  { key: "descriptionHtml", group: "product", label: "Description (HTML)", hint: "" },
  { key: "vendor", group: "product", label: "Vendor", hint: "" },
  { key: "productType", group: "product", label: "Product type", hint: "" },
  { key: "tags", group: "product", label: "Tags", hint: "Comma separated — replaces the product's tags" },
  { key: "status", group: "product", label: "Status", hint: "active, draft or archived" },
  { key: "published", group: "product", label: "Published", hint: "TRUE / FALSE — publish to all sales channels (blank counts as TRUE)" },
  { key: "handle", group: "product", label: "URL handle", hint: "Changing it changes the product's page address" },
  { key: "seoTitle", group: "product", label: "SEO title", hint: "" },
  { key: "seoDescription", group: "product", label: "SEO description", hint: "" },
  { key: "templateSuffix", group: "product", label: "Theme template", hint: "Template suffix, e.g. wide" },
  { key: "sku", group: "variant", label: "SKU", hint: "Applied to the matched variant — changing it changes the SKU you matched on" },
  { key: "price", group: "variant", label: "Price", hint: "Applied to the matched variant" },
  { key: "compareAtPrice", group: "variant", label: "Compare-at price", hint: "Applied to the matched variant" },
  { key: "barcode", group: "variant", label: "Barcode", hint: "Applied to the matched variant" },
  { key: "weight", group: "variant", label: "Weight (grams)", hint: "Applied to the matched variant" },
  { key: "quantity", group: "variant", label: "Inventory quantity", hint: "Sets the stock to this number (it replaces the current count) at the location chosen below" },
  { key: "taxable", group: "variant", label: "Charge tax", hint: "yes / no — applied to the matched variant" },
  { key: "tracked", group: "variant", label: "Track inventory", hint: "yes / no — applied to the matched variant" },
  { key: "continueSelling", group: "variant", label: "Continue selling when out of stock", hint: "yes / no — applied to the matched variant" },
] as const;

export type ApplyFieldKey = (typeof APPLY_FIELDS)[number]["key"];
export type ApplyFieldGroup = (typeof APPLY_FIELDS)[number]["group"];
/** Field → CSV column index. A field that isn't listed is never touched. */
export type FieldMapping = Partial<Record<ApplyFieldKey, number>>;
/** Only the fields that had a non-empty value in the CSV row — an empty cell never erases anything in the store. */
export type ApplyFieldValues = Partial<Record<ApplyFieldKey, string>>;

export const isVariantField = (key: ApplyFieldKey): boolean => APPLY_FIELDS.some((f) => f.key === key && f.group === "variant");

const HEADER_GUESSES: Record<ApplyFieldKey, RegExp> = {
  title: /^(product\s*)?title$|^name$/i,
  descriptionHtml: /^(body\s*\(html\)|body html|description(\s*\(html\))?|product description)$/i,
  vendor: /^(product\s*)?vendor$/i,
  productType: /^(product\s*)?type$|^product[\s_-]*type$/i,
  tags: /^tags?$/i,
  status: /^(product\s*)?status$/i,
  published: /^published(\s*on\s*online\s*store)?$/i,
  handle: /^(url[\s_-]*)?handle$/i,
  seoTitle: /^seo[\s_-]*title$/i,
  seoDescription: /^seo[\s_-]*description$/i,
  templateSuffix: /^(theme[\s_-]*)?template([\s_-]*suffix)?$/i,
  sku: /^(variant\s*)?sku$/i,
  price: /^(variant\s*)?price$/i,
  compareAtPrice: /^(variant\s*)?compare[\s-]*at[\s-]*price$/i,
  barcode: /^(variant\s*)?barcode$/i,
  weight: /^(variant\s*)?(weight|grams)(\s*\(g\))?$|^variant[\s_-]*grams$/i,
  quantity: /^(variant\s*)?(inventory\s*)?(qty|quantity|stock|inventory)(\s*(on[\s_-]*hand|available))?$/i,
  taxable: /^(variant\s*)?(taxable|charge[\s_-]*tax)$/i,
  tracked: /^(variant\s*)?(inventory[\s_-]*tracker|track[\s_-]*inventory|tracked)$/i,
  continueSelling: /^(variant\s*)?(inventory[\s_-]*policy|continue[\s_-]*selling.*)$/i,
};

/** Pre-fills the mapping from familiar header names (Shopify's own import CSV names included). */
export function suggestFieldMapping(headers: string[]): FieldMapping {
  const mapping: FieldMapping = {};
  for (const field of APPLY_FIELDS) {
    // The CSV's SKU column is what rows are matched on — rewriting it into the store would be a no-op at best, so it is never auto-selected.
    if (field.key === "sku") continue;
    const index = headers.findIndex((h) => HEADER_GUESSES[field.key].test(h.trim()));
    if (index >= 0) mapping[field.key] = index;
  }
  return mapping;
}

export function valuesFromRow(cells: string[], mapping: FieldMapping): ApplyFieldValues {
  const values: ApplyFieldValues = {};
  for (const field of APPLY_FIELDS) {
    const index = mapping[field.key];
    if (index === undefined) continue;
    const value = (cells[index] ?? "").trim();
    if (value) values[field.key] = value;
  }
  return values;
}

/** One store metafield definition mapped to a CSV column. */
export interface MetafieldMapping {
  namespace: string;
  key: string;
  /** The metafield's type name, e.g. "single_line_text_field". */
  type: string;
  /** The CSV column the value comes from — absent when `fixed` content is used instead. */
  column?: number;
  /** One piece of content written once in the tool and saved on every product (rich text metafields only). */
  fixed?: string;
  /** How a rich text metafield's CSV text is laid out. */
  format?: RichTextFormat;
}

/** One metafield value ready to write to a product. */
export interface MetafieldWrite {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Plain text from simple HTML: block ends and <br> become line breaks, tags are dropped, common entities decoded. */
function htmlToPlainText(html: string): string {
  if (!html.includes("<")) return html;
  return html
    .replace(/<\s*br\s*\/?>|<\/\s*(p|li|div|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Rich text metafields only accept Shopify's JSON document format — plain text is rejected, which leaves the field empty.
 * HTML keeps its lists, bold and italic; plain text is split on line breaks or `|` and saved in the chosen layout.
 */
function toRichTextDocument(value: string, format: RichTextFormat): string {
  if (value.startsWith("{")) {
    const parsed = parseJson(value) as { type?: string } | undefined;
    if (parsed?.type === "root") return value;
  }
  const hasHtml = /<\/?[a-z][^>]*>/i.test(value);
  if (!hasHtml) return plainTextToRichText(value, format);
  // HTML that already has list items keeps its own structure; otherwise the chosen layout applies to its paragraphs.
  if (/<li[\s>]/i.test(value) || format === "paragraphs") return htmlToRichText(value);
  return plainTextToRichText(htmlToPlainText(value), format);
}

const MEASURE_UNITS: Record<string, Record<string, string>> = {
  dimension: { mm: "millimeters", millimeter: "millimeters", millimeters: "millimeters", cm: "centimeters", centimeter: "centimeters", centimeters: "centimeters", m: "meters", meter: "meters", meters: "meters", in: "inches", inch: "inches", inches: "inches", ft: "feet", foot: "feet", feet: "feet", yd: "yards", yard: "yards", yards: "yards" },
  weight: { g: "grams", gm: "grams", gram: "grams", grams: "grams", kg: "kilograms", kilogram: "kilograms", kilograms: "kilograms", oz: "ounces", ounce: "ounces", ounces: "ounces", lb: "pounds", lbs: "pounds", pound: "pounds", pounds: "pounds" },
  volume: { ml: "milliliters", milliliter: "milliliters", milliliters: "milliliters", l: "liters", liter: "liters", liters: "liters", cl: "centiliters", centiliters: "centiliters" },
};

/** "12 CM" → {"value":12,"unit":"centimeters"} for dimension / weight / volume metafields; anything unrecognised is left as typed. */
function toMeasurement(type: string, value: string): string {
  if (value.startsWith("{")) return value;
  const match = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/.exec(value);
  const unit = match?.[2] ? MEASURE_UNITS[type]?.[match[2].toLowerCase()] : undefined;
  return match && unit ? JSON.stringify({ value: Number(match[1]), unit }) : value;
}

/** A comma / `||` / line-separated cell → the JSON array a list.single_line_text_field metafield expects. */
function toTextList(value: string): string {
  if (value.startsWith("[") && Array.isArray(parseJson(value))) return value;
  return JSON.stringify(value.split(/\s*(?:\|\||,|\n)\s*/).map((item) => item.trim()).filter(Boolean));
}

/**
 * Converts a CSV cell into the exact format Shopify requires for the metafield's
 * type. Without this a perfectly good cell is rejected (rich text needs a JSON
 * document, booleans need true/false, measurements need value + unit, …).
 * Types with no special format are passed through untouched.
 */
export function coerceMetafieldValue(type: string, raw: string, format: RichTextFormat = "paragraphs"): string {
  const value = raw.trim();
  switch (type) {
    case "rich_text_field":
      return toRichTextDocument(value, format);
    case "single_line_text_field":
      return value.replace(/\s*\n+\s*/g, " ");
    case "boolean": {
      const parsed = parseYesNo(value);
      return parsed === null ? value : String(parsed);
    }
    case "number_integer":
    case "number_decimal":
      return value.replace(/,/g, "");
    case "dimension":
    case "weight":
    case "volume":
      return toMeasurement(type, value);
    case "list.single_line_text_field":
      return toTextList(value);
    default:
      return value;
  }
}

/** Non-empty cells only — like the core fields, a blank cell never clears a metafield. */
export function metafieldWritesFromRow(cells: string[], mappings: MetafieldMapping[]): MetafieldWrite[] {
  const writes: MetafieldWrite[] = [];
  for (const m of mappings) {
    const value = (m.fixed ?? (m.column !== undefined ? cells[m.column] : "") ?? "").trim();
    if (!value) continue;
    const coerced = coerceMetafieldValue(m.type, value, m.format ?? "paragraphs");
    // An editor left empty (or only whitespace / line breaks) produces an empty document, which Shopify would reject.
    if (m.type === "rich_text_field" && isEmptyRichText(coerced)) continue;
    writes.push({ namespace: m.namespace, key: m.key, type: m.type, value: coerced });
  }
  return writes;
}

const normalizeHeader = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Finds the CSV column whose header names this metafield — its display name,
 * its key, "namespace.key", or Shopify's export style "Name (product.metafields.ns.key)".
 * Columns in `taken` (already used by a core field) are never offered.
 */
export function guessMetafieldColumn(
  headers: string[],
  definition: { name: string; namespace: string; key: string },
  taken: ReadonlySet<number>,
): number {
  const fullKey = `${definition.namespace}.${definition.key}`.toLowerCase();
  const names = new Set([normalizeHeader(definition.name), normalizeHeader(definition.key), normalizeHeader(fullKey)]);
  return headers.findIndex((header, index) => {
    if (taken.has(index)) return false;
    const lower = header.toLowerCase();
    return names.has(normalizeHeader(header)) || lower.includes(`metafields.${fullKey}`) || lower.includes(`metafield: ${fullKey}`);
  });
}

export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export type ProductStatusValue = "ACTIVE" | "DRAFT" | "ARCHIVED";

export function parseStatus(raw: string): ProductStatusValue | null {
  const upper = raw.trim().toUpperCase();
  return upper === "ACTIVE" || upper === "DRAFT" || upper === "ARCHIVED" ? upper : null;
}

const WEIGHT_PATTERN = /^\d+(\.\d+)?$/;

/** yes / no style cell → boolean, or null when it isn't recognisable. */
export function parseYesNo(raw: string): boolean | null {
  const lower = raw.trim().toLowerCase();
  if (["yes", "y", "true", "1", "continue", "shopify"].includes(lower)) return true;
  if (["no", "n", "false", "0", "deny"].includes(lower)) return false;
  return null;
}

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Returns a human-readable problem with these values, or null when they're safe to send to Shopify. */
export function validateFieldValues(values: ApplyFieldValues): string | null {
  if (values.status !== undefined && !parseStatus(values.status)) {
    return `Status "${values.status}" must be active, draft or archived.`;
  }
  for (const key of ["price", "compareAtPrice"] as const) {
    const raw = values[key];
    if (raw !== undefined && !MONEY_PATTERN.test(raw)) return `${key === "price" ? "Price" : "Compare-at price"} "${raw}" isn't a valid amount (e.g. 19.99).`;
  }
  if (values.title !== undefined && values.title.length > 255) return "Title is longer than 255 characters.";
  if (values.handle !== undefined && values.handle.length > 255) return "URL handle is longer than 255 characters.";
  if (values.sku !== undefined && values.sku.length > 255) return "SKU is longer than 255 characters.";
  if (values.seoTitle !== undefined && values.seoTitle.length > 255) return "SEO title is longer than 255 characters.";
  if (values.quantity !== undefined && !/^\d+(\.0+)?$/.test(values.quantity.trim())) return `Inventory quantity "${values.quantity}" must be a whole number of 0 or more.`;
  if (values.weight !== undefined && !WEIGHT_PATTERN.test(values.weight)) return `Weight "${values.weight}" isn't a valid number of grams.`;
  for (const key of ["published", "taxable", "tracked", "continueSelling"] as const) {
    const raw = values[key];
    if (raw !== undefined && parseYesNo(raw) === null) return `"${raw}" isn't yes or no (use yes/no, true/false or 1/0).`;
  }
  return null;
}

/** Where a new product's SKU gets written — mirrors the store-side field the CSV was matched against. */
export type SkuTarget = { kind: "variant" } | { kind: "metafield"; namespace: string; key: string; type: string };

export type ApplyItem =
  | { kind: "update"; productId: string; variantId: string | null; values: ApplyFieldValues; metafields?: MetafieldWrite[]; locationId?: string; skipUnchanged?: boolean }
  | { kind: "create"; sku: string; target: SkuTarget; values: ApplyFieldValues; imageUrls?: string[]; metafields?: MetafieldWrite[]; locationId?: string };

export interface ApplyResult {
  ok: boolean;
  error?: string;
  /** Non-fatal remark, e.g. variant fields skipped for a metafield match. */
  note?: string;
  /** The variant that was changed (or created with the product) — lets a result be read back from the store. */
  variantId?: string | null;
  /** True when the store already held every value of this row, so nothing was written. */
  skipped?: boolean;
  /** Set on a create whenever the product exists in the store — even when a follow-up step failed, so it isn't created twice by mistake. */
  productId?: string;
}
