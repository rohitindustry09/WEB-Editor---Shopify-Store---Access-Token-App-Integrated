import "server-only";
import { createNewProduct, updateExistingProduct } from "@/lib/shopify/productUpsert";
import { keepOnlyChanges } from "@/lib/shopify/unchanged";
import { APPLY_FIELDS, validateFieldValues, type ApplyFieldValues, type ApplyItem, type ApplyResult, type MetafieldWrite } from "@/lib/skuApply";

/** Server-side validation and application of one Upload & Update row — shared by the verify action and the parallel-worker route. */

export const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
export const LOCATION_GID = /^gid:\/\/shopify\/Location\/\d+$/;
export const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const METAFIELD_PART = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_VALUE_LENGTH = 100_000;
const MAX_IMAGE_URLS = 20;
const MAX_IMAGE_URL_LENGTH = 2000;

/** Only plain https image links are handed to Shopify; anything else is dropped rather than trusted. */
function cleanImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const urls: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || value.length > MAX_IMAGE_URL_LENGTH) continue;
    try {
      if (new URL(value).protocol === "https:") urls.push(value);
    } catch {
      // not a URL — skip it
    }
    if (urls.length >= MAX_IMAGE_URLS) break;
  }
  return urls;
}

/** Server actions are callable by anyone with the page open — rebuild the values from known keys only, capped in size, instead of trusting the client's object. */
export function cleanValues(raw: unknown): ApplyFieldValues | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const values: ApplyFieldValues = {};
  for (const field of APPLY_FIELDS) {
    const value = source[field.key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) return null;
    values[field.key] = value;
  }
  return values;
}

const MAX_METAFIELDS_PER_ROW = 250;

/** Same rule as the field values: rebuild from known shapes only — a malformed metafield list rejects the whole row. */
export function cleanMetafields(raw: unknown): MetafieldWrite[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_METAFIELDS_PER_ROW) return null;
  const writes: MetafieldWrite[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const { namespace, key, type, value } = entry as Record<string, unknown>;
    if (typeof namespace !== "string" || typeof key !== "string" || typeof type !== "string" || typeof value !== "string") return null;
    if (!METAFIELD_PART.test(namespace) || !METAFIELD_PART.test(key) || !METAFIELD_PART.test(type) || value.length > MAX_VALUE_LENGTH) return null;
    writes.push({ namespace, key, type, value });
  }
  return writes;
}

/** Validates and applies one row. */
async function applyOne(item: ApplyItem): Promise<ApplyResult> {
  const values = cleanValues(item?.values);
  if (!values) return { ok: false, error: "Invalid row values." };
  const metafields = cleanMetafields(item?.metafields);
  if (!metafields) return { ok: false, error: "Invalid metafield values." };
  const locationId = typeof item?.locationId === "string" && LOCATION_GID.test(item.locationId) ? item.locationId : undefined;
  // Checked up front so a missing location can't leave a half-filled new product behind.
  if (values.quantity !== undefined && !locationId) return { ok: false, error: "Choose the stock location for the inventory quantity first." };
  const problem = validateFieldValues(values);
  if (problem) return { ok: false, error: problem };

  if (item.kind === "update") {
    if (!PRODUCT_GID.test(item.productId)) return { ok: false, error: "Invalid product id." };
    if (item.variantId !== null && !VARIANT_GID.test(item.variantId)) return { ok: false, error: "Invalid variant id." };
    if (item.skipUnchanged === true) {
      const changes = await keepOnlyChanges(item.productId, item.variantId, values, metafields, locationId ?? null);
      if (changes.allUnchanged) return { ok: true, skipped: true, productId: item.productId, variantId: item.variantId, note: "Already up to date — skipped." };
      const result = await updateExistingProduct(item.productId, item.variantId, changes.values, changes.metafields, locationId);
      const kept = changes.unchangedCount > 0 ? `${changes.unchangedCount} value${changes.unchangedCount === 1 ? "" : "s"} already up to date, left as is.` : "";
      return kept && result.ok ? { ...result, note: [result.note, kept].filter(Boolean).join(" ") } : result;
    }
    return updateExistingProduct(item.productId, item.variantId, values, metafields, locationId);
  }

  if (item.kind === "create") {
    const sku = typeof item.sku === "string" ? item.sku.trim() : "";
    if (!sku || sku.length > 255) return { ok: false, error: "Invalid SKU." };
    const { target } = item;
    if (target.kind === "metafield") {
      if (!METAFIELD_PART.test(target.namespace) || !METAFIELD_PART.test(target.key) || !METAFIELD_PART.test(target.type)) {
        return { ok: false, error: "Invalid metafield." };
      }
    } else if (target.kind !== "variant") {
      return { ok: false, error: "Invalid SKU target." };
    }
    return createNewProduct(sku, target, values, cleanImageUrls(item.imageUrls), metafields, locationId);
  }

  return { ok: false, error: "Unknown action." };
}

const MAX_ATTEMPTS = 4;
const RATE_LIMIT_PATTERN = /throttl|rate limit|429|50[23]/i;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One row, retried with backoff when Shopify says "slow down". A row is only
 * retried while nothing was created for it — once a product exists the result
 * carries its id and is returned as is, so a retry can never duplicate it.
 */
export async function applyRow(item: ApplyItem): Promise<ApplyResult> {
  let result = await applyOne(item);
  for (let attempt = 1; attempt < MAX_ATTEMPTS && !result.ok && !result.productId && RATE_LIMIT_PATTERN.test(result.error ?? ""); attempt++) {
    await wait(600 * 2 ** attempt);
    result = await applyOne(item);
  }
  return result;
}

