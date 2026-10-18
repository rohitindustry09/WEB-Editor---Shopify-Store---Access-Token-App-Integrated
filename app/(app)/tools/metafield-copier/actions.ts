"use server";

import {
  getProductMetafieldDefinitions,
  getSourceProductSummary,
  getProductMetafieldValue,
  searchProductsForMetafieldCopier,
  findProductsBySkuList,
  getProductsByIds,
  setProductMetafield,
  type MetafieldDefinitionSummary,
  type SourceProductSummary,
  type ProductMetafieldValue,
  type MetafieldCopierProduct,
  type MetafieldReferenceItem,
} from "@/lib/shopify/metafields";

export type {
  MetafieldDefinitionSummary,
  SourceProductSummary,
  ProductMetafieldValue,
  MetafieldCopierProduct,
  MetafieldReferenceItem,
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function getMetafieldDefinitionsAction(): Promise<{
  ok: boolean;
  definitions: MetafieldDefinitionSummary[];
  error?: string;
}> {
  try {
    return { ok: true, definitions: await getProductMetafieldDefinitions() };
  } catch (err) {
    return { ok: false, definitions: [], error: errorMessage(err, "Couldn't load metafield definitions.") };
  }
}

export async function getSourceProductAction(
  productId: string,
): Promise<{ ok: boolean; product: SourceProductSummary | null; error?: string }> {
  try {
    const product = await getSourceProductSummary(productId);
    if (!product) return { ok: false, product: null, error: "Product not found." };
    return { ok: true, product };
  } catch (err) {
    return { ok: false, product: null, error: errorMessage(err, "Couldn't load this product.") };
  }
}

export async function getSourceMetafieldValueAction(
  productId: string,
  namespace: string,
  key: string,
): Promise<{ ok: boolean; value: ProductMetafieldValue | null; error?: string }> {
  try {
    return { ok: true, value: await getProductMetafieldValue(productId, namespace, key) };
  } catch (err) {
    return { ok: false, value: null, error: errorMessage(err, "Couldn't load this metafield's value.") };
  }
}

export async function searchProductsForCopierAction(
  query: string,
): Promise<{ ok: boolean; products: MetafieldCopierProduct[]; error?: string }> {
  try {
    return { ok: true, products: await searchProductsForMetafieldCopier(query) };
  } catch (err) {
    return { ok: false, products: [], error: errorMessage(err, "Search failed.") };
  }
}

export async function findProductsBySkuListAction(
  skus: string[],
): Promise<{ ok: boolean; products: MetafieldCopierProduct[]; error?: string }> {
  try {
    return { ok: true, products: await findProductsBySkuList(skus) };
  } catch (err) {
    return { ok: false, products: [], error: errorMessage(err, "SKU lookup failed.") };
  }
}

export async function getProductsByIdsAction(
  ids: string[],
): Promise<{ ok: boolean; products: MetafieldCopierProduct[]; error?: string }> {
  try {
    return { ok: true, products: await getProductsByIds(ids) };
  } catch (err) {
    return { ok: false, products: [], error: errorMessage(err, "Couldn't load these products.") };
  }
}

export async function copyMetafieldToProductAction(
  targetProductId: string,
  namespace: string,
  key: string,
  type: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await setProductMetafield(targetProductId, namespace, key, type, value);
  } catch (err) {
    return { ok: false, error: errorMessage(err, "Couldn't write this metafield.") };
  }
}
