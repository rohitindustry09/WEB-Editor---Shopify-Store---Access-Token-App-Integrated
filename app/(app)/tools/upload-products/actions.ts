"use server";

import { getProductMetafieldDefinitions, type MetafieldDefinitionSummary } from "@/lib/shopify/metafields";
import { fetchVariantSkuPage, fetchMetafieldSkuPage, type StoreSkuPage } from "@/lib/shopify/skuIndex";
import { verifyProductWrites, type FieldCheck } from "@/lib/shopify/verifyProduct";
import { getLocations, type StockLocation } from "@/lib/shopify/stock";
import { cleanMetafields, cleanValues, LOCATION_GID, PRODUCT_GID, VARIANT_GID } from "@/lib/uploadApply";

export type StoreSkuSource = { kind: "variant" } | { kind: "metafield"; namespace: string; key: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function getSkuMetafieldOptionsAction(): Promise<{
  ok: boolean;
  definitions: MetafieldDefinitionSummary[];
  error?: string;
}> {
  try {
    return { ok: true, definitions: await getProductMetafieldDefinitions() };
  } catch (err) {
    return { ok: false, definitions: [], error: errorMessage(err, "Couldn't load the store's metafields.") };
  }
}

/** The store's stock locations, for the "Inventory quantity" field. */
export async function getLocationsAction(): Promise<{ ok: boolean; locations: StockLocation[]; error?: string }> {
  try {
    return { ok: true, locations: await getLocations() };
  } catch (err) {
    return { ok: false, locations: [], error: errorMessage(err, "Couldn't load the store's locations.") };
  }
}

/** One page of the store's SKUs — the client calls this in a loop so it can show live progress between pages. */
export async function loadStoreSkuPageAction(
  source: StoreSkuSource,
  cursor: string | null,
): Promise<({ ok: true } & StoreSkuPage) | { ok: false; error: string }> {
  try {
    if (source.kind === "metafield") {
      if (!source.namespace || !source.key) return { ok: false, error: "Pick a metafield first." };
      return { ok: true, ...(await fetchMetafieldSkuPage(source.namespace, source.key, cursor)) };
    }
    return { ok: true, ...(await fetchVariantSkuPage(cursor)) };
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't read SKUs from the store.") };
  }
}

/**
 * Reads one product back from the store and compares it with what its CSV row
 * was meant to write — the proof that fields and metafields really landed,
 * independent of whether Shopify's own response said "ok".
 */
export async function verifyApplyAction(
  productId: string,
  variantId: string | null,
  rawValues: unknown,
  rawMetafields: unknown,
  rawLocationId?: unknown,
): Promise<{ ok: true; checks: FieldCheck[] } | { ok: false; error: string }> {
  const values = cleanValues(rawValues);
  const metafields = cleanMetafields(rawMetafields);
  if (!values || !metafields) return { ok: false, error: "Invalid values to check." };
  if (!PRODUCT_GID.test(productId) || (variantId !== null && !VARIANT_GID.test(variantId))) return { ok: false, error: "Invalid product id." };
  try {
    const locationId = typeof rawLocationId === "string" && LOCATION_GID.test(rawLocationId) ? rawLocationId : null;
    return { ok: true, checks: await verifyProductWrites(productId, variantId, values, metafields, locationId) };
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't read the product back.") };
  }
}
