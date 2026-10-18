import { shopifyGraphQL } from "./client";
import { readVariantQuantity } from "./stock";
import { APPLY_FIELDS, parseStatus, parseTags, parseYesNo, type ApplyFieldKey, type ApplyFieldValues, type MetafieldWrite } from "@/lib/skuApply";

/** One thing the CSV said to write, and what the store actually holds now. */
export interface FieldCheck {
  label: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface StoredProduct {
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  descriptionHtml: string;
  handle: string;
  status: string;
  templateSuffix: string | null;
  seo: { title: string | null; description: string | null };
  metafields: { nodes: { namespace: string; key: string; value: string }[] };
}

export interface StoredVariant {
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  taxable: boolean;
  inventoryPolicy: string;
  inventoryItem: { tracked: boolean; measurement: { weight: { value: number } | null } | null };
}

const PRODUCT_PART = `
    product(id: $id) {
      title vendor productType tags descriptionHtml handle status templateSuffix
      seo { title description }
      metafields(first: 250) { nodes { namespace key value } }
    }`;
const VARIANT_PART = `
    productVariant(id: $variantId) {
      sku price compareAtPrice barcode taxable inventoryPolicy
      inventoryItem { tracked measurement { weight { value } } }
    }`;
const VERIFY_QUERY = `query VerifyProduct($id: ID!) {${PRODUCT_PART}
}`;
const VERIFY_WITH_VARIANT_QUERY = `query VerifyProduct($id: ID!, $variantId: ID!) {${PRODUCT_PART}${VARIANT_PART}
}`;

const sameNumber = (a: string, b: string): boolean => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b);

/** JSON metafields (rich text, measurements, lists) come back re-serialised, so compare them structurally. */
function sameJson(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** HTML with whitespace between tags removed and runs of spaces collapsed — Shopify re-formats stored HTML, so this is what "the same" means. */
function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").replace(/>\s+</g, "><").replace(/\s*(<\/?(?:p|ul|ol|li|br|div|h[1-6])\b[^>]*>)\s*/gi, "$1").trim().toLowerCase();
}

/** The visible text of an HTML fragment — a last resort for "same content, different markup". */
function htmlText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sameHtml(expected: string, actual: string): boolean {
  return normalizeHtml(expected) === normalizeHtml(actual) || htmlText(expected) === htmlText(actual);
}

function sameTags(expected: string, actual: string[]): boolean {
  const want = parseTags(expected).map((t) => t.toLowerCase()).sort();
  const have = actual.map((t) => t.toLowerCase()).sort();
  return want.length === have.length && want.every((t, i) => t === have[i]);
}

/** Pure comparison of what the CSV row said to write against what the store returned — exported for tests. */
export function compareWithStore(
  stored: StoredProduct,
  variant: StoredVariant | null,
  values: ApplyFieldValues,
  metafields: MetafieldWrite[],
  options: { strictHtml?: boolean } = {},
): FieldCheck[] {
  const checks: FieldCheck[] = [];
  const label = (key: ApplyFieldKey) => APPLY_FIELDS.find((f) => f.key === key)?.label ?? key;
  const add = (key: ApplyFieldKey, actual: string, ok: boolean) => {
    const expected = values[key];
    if (expected !== undefined) checks.push({ label: label(key), expected, actual, ok });
  };
  const text = (key: ApplyFieldKey, actual: string | null | undefined) => add(key, actual ?? "", (actual ?? "").trim() === (values[key] ?? "").trim());

  text("title", stored.title);
  if (values.descriptionHtml !== undefined) add("descriptionHtml", stored.descriptionHtml, options.strictHtml ? normalizeHtml(values.descriptionHtml) === normalizeHtml(stored.descriptionHtml) : sameHtml(values.descriptionHtml, stored.descriptionHtml));
  text("vendor", stored.vendor);
  text("productType", stored.productType);
  text("handle", stored.handle);
  text("seoTitle", stored.seo.title);
  text("seoDescription", stored.seo.description);
  text("templateSuffix", stored.templateSuffix);
  if (values.tags !== undefined) add("tags", stored.tags.join(", "), sameTags(values.tags, stored.tags));
  if (values.status !== undefined) add("status", stored.status.toLowerCase(), parseStatus(values.status) === stored.status);

  if (variant) {
    text("sku", variant.sku);
    text("barcode", variant.barcode);
    if (values.price !== undefined) add("price", variant.price, sameNumber(values.price, variant.price));
    if (values.compareAtPrice !== undefined) add("compareAtPrice", variant.compareAtPrice ?? "", sameNumber(values.compareAtPrice, variant.compareAtPrice ?? ""));
    if (values.weight !== undefined) {
      const grams = String(variant.inventoryItem.measurement?.weight?.value ?? "");
      add("weight", grams, sameNumber(values.weight, grams));
    }
    if (values.taxable !== undefined) add("taxable", variant.taxable ? "yes" : "no", parseYesNo(values.taxable) === variant.taxable);
    if (values.tracked !== undefined) add("tracked", variant.inventoryItem.tracked ? "yes" : "no", parseYesNo(values.tracked) === variant.inventoryItem.tracked);
    if (values.continueSelling !== undefined) {
      add("continueSelling", variant.inventoryPolicy === "CONTINUE" ? "yes" : "no", parseYesNo(values.continueSelling) === (variant.inventoryPolicy === "CONTINUE"));
    }
  }

  for (const m of metafields) {
    const found = stored.metafields.nodes.find((n) => n.namespace === m.namespace && n.key === m.key);
    const actual = found?.value ?? "";
    // Number-like metafields come back normalised (e.g. 5 → 5.0), so compare those numerically.
    const ok = found !== undefined && (actual.trim() === m.value.trim() || sameNumber(actual, m.value) || sameJson(actual, m.value));
    checks.push({ label: `Metafield ${m.namespace}.${m.key}`, expected: m.value, actual: found ? actual : "(not set)", ok });
  }
  return checks;
}

const PUBLICATION_COUNT_QUERY = `query ProductChannels($id: ID!) { product(id: $id) { resourcePublicationsCount { count } } }`;

/** How many sales channels the product is on — best effort: without the publications scope this is simply skipped. */
async function readChannelCount(productId: string): Promise<number | null> {
  try {
    const data = await shopifyGraphQL<{ product: { resourcePublicationsCount: { count: number } | null } | null }>(PUBLICATION_COUNT_QUERY, { id: productId });
    return data.product?.resourcePublicationsCount?.count ?? null;
  } catch {
    return null;
  }
}

/** Reads a product back from the store and checks every value the CSV row was meant to write. */
export async function verifyProductWrites(
  productId: string,
  variantId: string | null,
  values: ApplyFieldValues,
  metafields: MetafieldWrite[],
  locationId: string | null = null,
  options: { strictHtml?: boolean } = {},
): Promise<FieldCheck[]> {
  const data = await shopifyGraphQL<{ product: StoredProduct | null; productVariant?: StoredVariant | null }>(
    variantId ? VERIFY_WITH_VARIANT_QUERY : VERIFY_QUERY,
    variantId ? { id: productId, variantId } : { id: productId },
  );
  if (!data.product) throw new Error("The product couldn't be found in the store.");
  const checks = compareWithStore(data.product, data.productVariant ?? null, values, metafields, options);
  if (values.quantity !== undefined && variantId && locationId) {
    const stock = await readVariantQuantity(variantId, locationId);
    if (stock !== null) checks.push({ label: "Inventory quantity", expected: values.quantity, actual: String(stock), ok: Number(values.quantity) === stock });
  }
  if (values.published !== undefined) {
    const count = await readChannelCount(productId);
    if (count !== null) {
      const want = parseYesNo(values.published) !== false;
      checks.push({ label: "Published (sales channels)", expected: want ? "published" : "unpublished", actual: count > 0 ? `on ${count} channel${count === 1 ? "" : "s"}` : "no channels", ok: want ? count > 0 : count === 0 });
    }
  }
  return checks;
}
