import { shopifyGraphQL } from "./client";
import { addProductImages, updateProduct, updateVariant } from "./products";
import { setProductMetafield, setProductMetafields } from "./metafields";
import { setProductPublished } from "./publishing";
import { setVariantQuantity } from "./stock";
import type { UserError } from "./types";
import { isVariantField, parseStatus, parseTags, parseYesNo, type ApplyFieldValues, type ApplyResult, type MetafieldWrite, type SkuTarget } from "@/lib/skuApply";
import type { VariantUpdateInput } from "./products";

function errorText(errors: UserError[]): string {
  return errors.map((e) => e.message).join("; ");
}

const isThrottled = (err: unknown): boolean => /throttl|rate limit|429/i.test(err instanceof Error ? err.message : "");

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** The product-level subset of the CSV values, in the shape Shopify's ProductInput expects. */
function productFields(values: ApplyFieldValues): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (values.title !== undefined) input.title = values.title;
  if (values.descriptionHtml !== undefined) input.descriptionHtml = values.descriptionHtml;
  if (values.vendor !== undefined) input.vendor = values.vendor;
  if (values.productType !== undefined) input.productType = values.productType;
  if (values.tags !== undefined) input.tags = parseTags(values.tags);
  if (values.handle !== undefined) input.handle = values.handle;
  if (values.templateSuffix !== undefined) input.templateSuffix = values.templateSuffix;
  if (values.seoTitle !== undefined || values.seoDescription !== undefined) {
    input.seo = {
      ...(values.seoTitle !== undefined ? { title: values.seoTitle } : {}),
      ...(values.seoDescription !== undefined ? { description: values.seoDescription } : {}),
    };
  }
  return input;
}

function hasVariantFields(values: ApplyFieldValues): boolean {
  return (Object.keys(values) as (keyof ApplyFieldValues)[]).some((key) => isVariantField(key));
}

/** The variant-level subset of the CSV values — only what was present, already validated by the caller. */
function variantFields(values: ApplyFieldValues): VariantUpdateInput {
  const input: VariantUpdateInput = {};
  if (values.sku !== undefined) input.sku = values.sku;
  if (values.price !== undefined) input.price = values.price;
  if (values.compareAtPrice !== undefined) input.compareAtPrice = values.compareAtPrice;
  if (values.barcode !== undefined) input.barcode = values.barcode;
  if (values.weight !== undefined) input.weight = Number(values.weight);
  if (values.taxable !== undefined) input.taxable = parseYesNo(values.taxable) ?? undefined;
  if (values.tracked !== undefined) input.tracked = parseYesNo(values.tracked) ?? undefined;
  if (values.continueSelling !== undefined) {
    const on = parseYesNo(values.continueSelling);
    if (on !== null) input.inventoryPolicy = on ? "CONTINUE" : "DENY";
  }
  return input;
}

/**
 * Writes the metafields and returns one readable problem per metafield that
 * didn't save. One batched call first (fast path); Shopify rejects a whole call
 * when any single value is invalid, so on any error each metafield is retried on
 * its own — one bad value then costs only itself, never its neighbours.
 */
async function writeMetafields(productId: string, metafields: MetafieldWrite[]): Promise<string[]> {
  if (metafields.length === 0) return [];
  try {
    if ((await setProductMetafields(productId, metafields)).length === 0) return [];
  } catch (err) {
    // Still throttled after the client's patient retries: more calls would only make it worse.
    if (isThrottled(err)) return [`metafields: ${messageOf(err, "Throttled")} — wait a moment and use Retry`];
    // otherwise fall through to the one-by-one pass
  }
  const problems: string[] = [];
  for (const m of metafields) {
    try {
      const result = await setProductMetafield(productId, m.namespace, m.key, m.type, m.value);
      if (!result.ok) problems.push(`metafield ${m.namespace}.${m.key}: ${result.error ?? "couldn't be saved"}`);
    } catch (err) {
      problems.push(`metafield ${m.namespace}.${m.key}: ${messageOf(err, "couldn't be saved")}`);
    }
  }
  return problems;
}

const PRODUCT_VARIANTS_QUERY = `
  query ProductVariantsOf($id: ID!) {
    product(id: $id) { variants(first: 2) { nodes { id } } }
  }
`;

/**
 * For a product that was matched through a metafield there is no matched variant.
 * When the product has exactly one variant (no size / colour options) that variant
 * is unambiguous, so price, stock and the other variant fields go to it; with
 * several variants it is left alone rather than guessed.
 */
async function findOnlyVariant(productId: string): Promise<{ variantId: string | null; count: number }> {
  try {
    const data = await shopifyGraphQL<{ product: { variants: { nodes: { id: string }[] } } | null }>(PRODUCT_VARIANTS_QUERY, { id: productId });
    const nodes = data.product?.variants.nodes ?? [];
    return { variantId: nodes.length === 1 ? nodes[0].id : null, count: nodes.length };
  } catch {
    return { variantId: null, count: 0 };
  }
}

/** Sets a variant's stock at the chosen location; a missing location is a clear problem, not a silent skip. */
async function writeQuantity(variantId: string, locationId: string | undefined, quantity: string): Promise<string[]> {
  if (!locationId) return ["Inventory quantity: choose the stock location first."];
  return setVariantQuantity(variantId, locationId, Number(quantity));
}

/** Splits a variant update into single-field updates, so the failing field can be named. */
function singleFieldUpdates(input: VariantUpdateInput): [string, VariantUpdateInput][] {
  const pieces: [string, VariantUpdateInput][] = [];
  for (const key of Object.keys(input) as (keyof VariantUpdateInput)[]) {
    if (key === "weightUnit") continue;
    pieces.push([key, key === "weight" ? { weight: input.weight, weightUnit: input.weightUnit } : { [key]: input[key] }]);
  }
  return pieces;
}

/**
 * Applies variant fields in one call; if Shopify rejects it, retries field by field
 * so the good fields still land and the bad one is named in the problem list.
 */
async function writeVariant(productId: string, variantId: string, input: VariantUpdateInput): Promise<string[]> {
  if (Object.keys(input).length === 0) return [];
  try {
    if ((await updateVariant(productId, variantId, input)).length === 0) return [];
  } catch (err) {
    if (isThrottled(err)) return [`variant fields: ${messageOf(err, "Throttled")} — wait a moment and use Retry`];
    // otherwise fall through to the field-by-field pass
  }
  const problems: string[] = [];
  for (const [name, piece] of singleFieldUpdates(input)) {
    try {
      const errors = await updateVariant(productId, variantId, piece);
      if (errors.length > 0) problems.push(`${name}: ${errorText(errors)}`);
    } catch (err) {
      problems.push(`${name}: ${messageOf(err, "couldn't be saved")}`);
    }
  }
  return problems;
}

/**
 * Writes only the values that were present in the CSV row — a blank cell
 * never erases anything on the product. `variantId` is null when the match
 * came from a product metafield: there is no single variant to change then,
 * so price/compare-at/barcode are skipped (and reported) rather than guessed.
 */
export async function updateExistingProduct(
  productId: string,
  variantId: string | null,
  values: ApplyFieldValues,
  metafields: MetafieldWrite[] = [],
  locationId?: string,
): Promise<ApplyResult> {
  const problems: string[] = [];
  let didSomething = false;
  let note: string | undefined;

  const input = productFields(values);
  const status = values.status !== undefined ? parseStatus(values.status) : null;
  if (status) input.status = status;

  if (Object.keys(input).length > 0) {
    try {
      const errors = await updateProduct({ id: productId, ...input });
      if (errors.length > 0) problems.push(errorText(errors));
      else didSomething = true;
    } catch (err) {
      problems.push(messageOf(err, "Couldn't update this product."));
    }
  }

  // A metafield match names a product, not a variant: use the product's only variant when it has just one.
  let targetVariantId = variantId;
  if (!targetVariantId && hasVariantFields(values)) {
    const only = await findOnlyVariant(productId);
    targetVariantId = only.variantId;
    if (!targetVariantId) {
      note =
        only.count > 1
          ? "Variant fields (SKU, price, stock, …) skipped — this product has several variants, so it isn't clear which one to change."
          : "Variant fields (SKU, price, stock, …) skipped — the product's variant couldn't be found.";
    }
  }

  if (hasVariantFields(values) && targetVariantId) {
    problems.push(...(await writeVariant(productId, targetVariantId, variantFields(values))));
    didSomething = true;
  }

  if (values.quantity !== undefined && targetVariantId) {
    problems.push(...(await writeQuantity(targetVariantId, locationId, values.quantity)));
    didSomething = true;
  }

  if (metafields.length > 0) {
    problems.push(...(await writeMetafields(productId, metafields)));
    didSomething = true;
  }

  if (values.published !== undefined) {
    problems.push(...(await setProductPublished(productId, parseYesNo(values.published) !== false)));
    didSomething = true;
  }

  if (problems.length > 0) return { ok: false, productId, variantId: targetVariantId, error: `Not everything was saved — ${problems.join("; ")}` };
  if (!didSomething && !note) return { ok: true, productId, variantId: targetVariantId, note: "Nothing to change — none of the mapped columns had a value in this row." };
  return { ok: true, productId, variantId: targetVariantId, note };
}

const FIND_VARIANT_BY_SKU_QUERY = `
  query FindVariantBySku($query: String!) {
    productVariants(first: 5, query: $query) { nodes { id sku product { id } } }
  }
`;

/**
 * The product + variant that already carry this SKU, if any. A "Create" that is
 * retried after a dropped connection may have succeeded the first time — this is
 * how the retry notices and finishes that product instead of making a second one.
 * (Shopify's search index can lag a few seconds behind a brand-new product.)
 */
async function findVariantBySku(sku: string): Promise<{ productId: string; variantId: string } | null> {
  try {
    const data = await shopifyGraphQL<{ productVariants: { nodes: { id: string; sku: string | null; product: { id: string } }[] } }>(FIND_VARIANT_BY_SKU_QUERY, {
      query: `sku:"${sku.replace(/["\\]/g, "")}"`,
    });
    const hit = data.productVariants.nodes.find((n) => (n.sku ?? "").trim().toLowerCase() === sku.trim().toLowerCase());
    return hit ? { productId: hit.product.id, variantId: hit.id } : null;
  } catch {
    return null;
  }
}

const PRODUCT_CREATE_MUTATION = `
  mutation ProductCreateFromCsv($input: ProductInput!) {
    productCreate(input: $input) {
      product { id variants(first: 1) { nodes { id } } }
      userErrors { field message }
    }
  }
`;

/**
 * Creates one product from a CSV row. New products default to DRAFT unless
 * the CSV maps a Status — nothing goes live on the storefront by accident.
 * The SKU is written where the CSV was matched: the default variant's SKU,
 * or the chosen text metafield. If a step after creation fails, the result
 * still carries `productId` so the product isn't blindly created twice.
 */
export async function createNewProduct(
  sku: string,
  target: SkuTarget,
  values: ApplyFieldValues,
  imageUrls: string[] = [],
  metafields: MetafieldWrite[] = [],
  locationId?: string,
): Promise<ApplyResult> {
  if (!values.title) return { ok: false, error: "No title in this row — map a Title column to create new products." };
  if (target.kind === "metafield" && target.type !== "single_line_text_field") {
    return { ok: false, error: "New products can only store their SKU in a single-line text metafield." };
  }

  if (target.kind === "variant") {
    const existing = await findVariantBySku(sku);
    if (existing) {
      const finished = await updateExistingProduct(existing.productId, existing.variantId, values, metafields, locationId);
      return { ...finished, note: `A product with SKU ${sku} already existed, so it was updated instead of created again.${finished.note ? ` ${finished.note}` : ""}` };
    }
  }

  let productId: string;
  let variantId: string | null;
  try {
    const data = await shopifyGraphQL<{
      productCreate: { product: { id: string; variants: { nodes: { id: string }[] } } | null; userErrors: UserError[] };
    }>(PRODUCT_CREATE_MUTATION, {
      input: { ...productFields(values), status: (values.status && parseStatus(values.status)) || "DRAFT" },
    });
    const { product, userErrors } = data.productCreate;
    if (userErrors.length > 0 || !product) return { ok: false, error: errorText(userErrors) || "Shopify didn't create the product." };
    productId = product.id;
    variantId = product.variants.nodes[0]?.id ?? null;
  } catch (err) {
    return { ok: false, error: messageOf(err, "Couldn't create this product.") };
  }

  // Every step below runs even if an earlier one failed — a product that exists should get as much of its data as Shopify will accept, and every problem is reported together.
  const problems: string[] = [];

  if (target.kind === "variant" || hasVariantFields(values)) {
    if (!variantId) {
      problems.push("no default variant was returned, so variant fields couldn't be set");
    } else {
      // The matched SKU is the new product's SKU; a mapped SKU column only matters when the match was on a metafield.
      problems.push(...(await writeVariant(productId, variantId, { ...variantFields(values), ...(target.kind === "variant" ? { sku } : {}) })));
    }
  }

  if (values.quantity !== undefined && variantId) problems.push(...(await writeQuantity(variantId, locationId, values.quantity)));

  if (target.kind === "metafield") {
    try {
      const result = await setProductMetafield(productId, target.namespace, target.key, target.type, sku);
      if (!result.ok) problems.push(`SKU metafield: ${result.error ?? "couldn't be saved"}`);
    } catch (err) {
      problems.push(`SKU metafield: ${messageOf(err, "couldn't be saved")}`);
    }
  }

  problems.push(...(await writeMetafields(productId, metafields)));

  if (values.published !== undefined) problems.push(...(await setProductPublished(productId, parseYesNo(values.published) !== false)));

  let imageNote: string | undefined;
  if (imageUrls.length > 0) {
    // Images are best-effort: a bad image URL is a note, not a failure.
    try {
      const errors = await addProductImages(productId, imageUrls.map((url) => ({ url })));
      if (errors.length > 0) imageNote = `Some images couldn't be added: ${errorText(errors)}`;
    } catch (err) {
      imageNote = `Images couldn't be added: ${messageOf(err, "unexpected error")}`;
    }
  }

  if (problems.length > 0) {
    return {
      ok: false,
      productId,
      variantId,
      error: `Product created, but not everything was saved — ${problems.join("; ")}. The product exists in Shopify; running Upload & Update again fills in what's missing.`,
    };
  }
  return { ok: true, productId, variantId, note: imageNote };
}
