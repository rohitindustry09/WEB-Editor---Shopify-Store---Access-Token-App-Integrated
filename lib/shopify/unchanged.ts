import { verifyProductWrites, type FieldCheck } from "./verifyProduct";
import { APPLY_FIELDS, type ApplyFieldKey, type ApplyFieldValues, type MetafieldWrite } from "@/lib/skuApply";

export const PUBLISHED_LABEL = "Published (sales channels)";
export const METAFIELD_PREFIX = "Metafield ";

export interface ChangesOnly {
  /** What is still different in the store — only this needs writing. */
  values: ApplyFieldValues;
  metafields: MetafieldWrite[];
  /** How many of the row's values already matched the store. */
  unchangedCount: number;
  /** True when every value the row would write is already in the store. */
  allUnchanged: boolean;
}

/**
 * Reads the product from the store and drops every value the CSV row wants to write that is already there
 * (same quantity, same price, same metafield, …). Anything that can't be compared — a variant field when no
 * variant is known, a quantity without a location, an unreadable product — is kept, so it is still written:
 * the only values ever skipped are ones the store has been seen to hold already.
 */
export async function keepOnlyChanges(
  productId: string,
  variantId: string | null,
  values: ApplyFieldValues,
  metafields: MetafieldWrite[],
  locationId: string | null,
): Promise<ChangesOnly> {
  let checks: FieldCheck[];
  try {
    checks = await verifyProductWrites(productId, variantId, values, metafields, locationId, { strictHtml: true });
  } catch {
    return { values, metafields, unchangedCount: 0, allUnchanged: false };
  }
  return reduceToChanges(values, metafields, checks);
}

/** Pure part: given the comparison results, keeps only the values the store doesn't hold yet. */
export function reduceToChanges(values: ApplyFieldValues, metafields: MetafieldWrite[], checks: FieldCheck[]): ChangesOnly {
  const sameKeys = new Set<ApplyFieldKey>();
  const sameMetafields = new Set<string>();
  for (const check of checks) {
    if (!check.ok) continue;
    if (check.label === PUBLISHED_LABEL) sameKeys.add("published");
    else if (check.label.startsWith(METAFIELD_PREFIX)) sameMetafields.add(check.label.slice(METAFIELD_PREFIX.length));
    else {
      const field = APPLY_FIELDS.find((f) => f.label === check.label);
      if (field) sameKeys.add(field.key);
    }
  }

  const remainingValues: ApplyFieldValues = {};
  for (const field of APPLY_FIELDS) {
    const value = values[field.key];
    if (value !== undefined && !sameKeys.has(field.key)) remainingValues[field.key] = value;
  }
  const remainingMetafields = metafields.filter((m) => !sameMetafields.has(`${m.namespace}.${m.key}`));

  const total = Object.keys(values).length + metafields.length;
  const left = Object.keys(remainingValues).length + remainingMetafields.length;
  return { values: remainingValues, metafields: remainingMetafields, unchangedCount: total - left, allUnchanged: total > 0 && left === 0 };
}
