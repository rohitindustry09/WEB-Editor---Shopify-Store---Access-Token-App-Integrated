import "server-only";
import { shopifyGraphQL } from "./client";
import { METAFIELD_PREFIX, PUBLISHED_LABEL, reduceToChanges } from "./unchanged";
import { compareWithStore, type FieldCheck, type StoredProduct, type StoredVariant } from "./verifyProduct";
import { APPLY_FIELDS, isVariantField, parseYesNo, type ApplyFieldKey, type ApplyFieldValues, type MetafieldWrite } from "@/lib/skuApply";

/** One CSV row to compare with the store. Ids, values and metafields must already be validated by the caller. */
export interface ScanItem {
  key: string;
  productId: string;
  variantId: string | null;
  values: ApplyFieldValues;
  metafields: MetafieldWrite[];
  locationId?: string;
}

/** One value of a row the store does not hold yet (or that could not be compared). */
export interface ScanReason {
  label: string;
  expected: string;
  actual: string;
}

export interface ScanOutcome {
  key: string;
  /** True only when the store was read and already holds every value this row would write. */
  upToDate: boolean;
  /** What is different (or could not be compared) — empty when up to date. */
  reasons: ScanReason[];
}

const MAX_REASONS_PER_ROW = 8;
const MAX_REASON_TEXT = 60;
const clip = (text: string): string => (text.length > MAX_REASON_TEXT ? `${text.slice(0, MAX_REASON_TEXT)}…` : text);

interface StockLevel {
  quantities: { name: string; quantity: number }[];
}

interface ScannedVariant extends StoredVariant {
  inventoryItem: StoredVariant["inventoryItem"] & { inventoryLevel?: StockLevel | null };
}

type ScannedProduct = Omit<StoredProduct, "metafields"> & {
  resourcePublicationsCount?: { count: number } | null;
  [alias: string]: unknown;
};

const PRODUCT_FIELDS = "title vendor productType tags descriptionHtml handle status templateSuffix seo { title description }";

/** The variant fields to read: everything comparable, plus the stock level at the chosen location when a quantity is being written. */
function variantSelection(item: ScanItem): string {
  const level =
    item.values.quantity !== undefined && item.locationId
      ? `inventoryLevel(locationId: ${JSON.stringify(item.locationId)}) { quantities(names: ["available"]) { name quantity } }`
      : "";
  return `sku price compareAtPrice barcode taxable inventoryPolicy inventoryItem { tracked measurement { weight { value } } ${level} }`;
}

/** The sales-channel count is only read when the row writes "published". */
const channelSelection = (item: ScanItem): string => (item.values.published !== undefined ? "resourcePublicationsCount { count }" : "");

const hasVariantValues = (values: ApplyFieldValues): boolean => (Object.keys(values) as ApplyFieldKey[]).some((key) => isVariantField(key));

/**
 * The product's and variant's fields for one row, as aliased selections so a whole batch is one request.
 * A row matched through a product metafield has no variant id: like the real update, the product's only
 * variant is used, so its first two variants are read to tell "exactly one" from "several".
 */
function selectionFor(item: ScanItem, index: number): string {
  const metafieldSelections = item.metafields
    .map((m, j) => `m${j}: metafield(namespace: ${JSON.stringify(m.namespace)}, key: ${JSON.stringify(m.key)}) { namespace key value }`)
    .join(" ");
  const onlyVariant = !item.variantId && hasVariantValues(item.values) ? `vs: variants(first: 2) { nodes { ${variantSelection(item)} } }` : "";
  const parts = [`p${index}: product(id: ${JSON.stringify(item.productId)}) { ${PRODUCT_FIELDS} ${channelSelection(item)} ${metafieldSelections} ${onlyVariant} }`];
  if (item.variantId) parts.push(`v${index}: productVariant(id: ${JSON.stringify(item.variantId)}) { ${variantSelection(item)} }`);
  return parts.join("\n");
}

/** Why a variant field of this row could not be compared. */
function variantProblem(item: ScanItem, product: ScannedProduct, variant: ScannedVariant | null): string {
  if (!variant) {
    const count = (product.vs as { nodes: unknown[] } | undefined)?.nodes.length ?? 0;
    return item.variantId ? "the variant could not be read" : count > 1 ? "product has several variants — no single one to compare" : "the product's variant could not be found";
  }
  if (!item.locationId) return "choose a stock location to compare quantities";
  return "not stocked at the chosen location";
}

function checksFor(item: ScanItem, product: ScannedProduct, variant: ScannedVariant | null): FieldCheck[] {
  const stored: StoredProduct = {
    ...product,
    metafields: {
      nodes: item.metafields.flatMap((_, j) => {
        const found = product[`m${j}`] as { namespace: string; key: string; value: string } | null | undefined;
        return found ? [found] : [];
      }),
    },
  };
  const checks = compareWithStore(stored, variant, item.values, item.metafields, { strictHtml: true });

  const wantedQuantity = item.values.quantity;
  const stock = variant?.inventoryItem.inventoryLevel?.quantities.find((q) => q.name === "available")?.quantity;
  if (wantedQuantity !== undefined && stock !== undefined) {
    checks.push({ label: "Inventory quantity", expected: wantedQuantity, actual: String(stock), ok: Number(wantedQuantity) === stock });
  }
  if (item.values.published !== undefined && product.resourcePublicationsCount) {
    const want = parseYesNo(item.values.published) !== false;
    const count = product.resourcePublicationsCount.count;
    checks.push({ label: "Published (sales channels)", expected: want ? "published" : "unpublished", actual: String(count), ok: want ? count > 0 : count === 0 });
  }
  return checks;
}

/**
 * Compares a batch of CSV rows with the store in ONE request and says which rows are already up to date.
 * A row that couldn't be read (deleted product, missing field) is simply "not up to date" so it still runs.
 */
export async function scanUpToDate(items: ScanItem[]): Promise<ScanOutcome[]> {
  if (items.length === 0) return [];
  const query = `query ScanUpToDate {\n${items.map(selectionFor).join("\n")}\n}`;
  const data = await shopifyGraphQL<Record<string, unknown>>(query);
  return items.map((item, index) => {
    const product = data[`p${index}`] as ScannedProduct | null | undefined;
    if (!product) return { key: item.key, upToDate: false, reasons: [{ label: "Product", expected: "found in store", actual: "could not be read" }] };
    const onlyNodes = (product.vs as { nodes: ScannedVariant[] } | undefined)?.nodes ?? [];
    const variant = item.variantId ? ((data[`v${index}`] as ScannedVariant | null | undefined) ?? null) : onlyNodes.length === 1 ? onlyNodes[0] : null;
    const checks = checksFor(item, product, variant);
    const changes = reduceToChanges(item.values, item.metafields, checks);
    const reasonFor = (label: string, expected: string): ScanReason => {
      const check = checks.find((c) => c.label === label);
      const variantLabel = APPLY_FIELDS.some((f) => f.label === label && isVariantField(f.key));
      const actual = check ? check.actual : variantLabel ? variantProblem(item, product, variant) : "could not be read from the store";
      return { label, expected: clip(check?.expected ?? expected), actual: clip(actual) };
    };
    const reasons: ScanReason[] = [
      ...(Object.keys(changes.values) as (keyof ApplyFieldValues)[]).map((key) =>
        reasonFor(key === "published" ? PUBLISHED_LABEL : (APPLY_FIELDS.find((f) => f.key === key)?.label ?? key), changes.values[key] ?? ""),
      ),
      ...changes.metafields.map((m) => reasonFor(`${METAFIELD_PREFIX}${m.namespace}.${m.key}`, m.value)),
    ].slice(0, MAX_REASONS_PER_ROW);
    return { key: item.key, upToDate: changes.allUnchanged, reasons };
  });
}
