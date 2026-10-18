import { shopifyGraphQL } from "./client";
import type { ProductStatus } from "./types";
import type { StoreSkuEntry } from "@/lib/skuMatch";

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/** One page of store SKUs. `total` is only filled on the first page (cursor null) and is null if the count couldn't be fetched. */
export interface StoreSkuPage {
  entries: StoreSkuEntry[];
  nextCursor: string | null;
  total: number | null;
  /** How many variants/products this page covered, including ones with no SKU — what `total` counts, so read-vs-total progress can actually reach 100%. */
  scanned: number;
}

const VARIANT_PAGE_SIZE = 250;
const PRODUCT_PAGE_SIZE = 250;

const VARIANT_SKU_QUERY = `
  query VariantSkuPage($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      nodes {
        id
        sku
        product { id title handle status featuredImage { url } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANT_COUNT_QUERY = `query VariantCount { productVariantsCount { count } }`;
const PRODUCT_COUNT_QUERY = `query ProductCount { productsCount { count } }`;

async function safeCount(query: string, pick: (data: never) => number): Promise<number | null> {
  try {
    return pick((await shopifyGraphQL(query)) as never);
  } catch {
    // The total only powers a progress readout — never worth failing the scan over.
    return null;
  }
}

/** One page (up to 250) of variant SKUs — Shopify's own standard SKU field. Variants with no SKU are skipped. */
export async function fetchVariantSkuPage(after: string | null): Promise<StoreSkuPage> {
  const data: {
    productVariants: {
      nodes: {
        id: string;
        sku: string | null;
        product: { id: string; title: string; handle: string; status: ProductStatus; featuredImage: { url: string } | null };
      }[];
      pageInfo: PageInfo;
    };
  } = await shopifyGraphQL(VARIANT_SKU_QUERY, { first: VARIANT_PAGE_SIZE, after });

  const entries: StoreSkuEntry[] = [];
  for (const node of data.productVariants.nodes) {
    const sku = node.sku?.trim();
    if (!sku) continue;
    entries.push({
      sku,
      productId: node.product.id,
      variantId: node.id,
      title: node.product.title,
      handle: node.product.handle,
      status: node.product.status,
      imageUrl: node.product.featuredImage?.url ?? null,
    });
  }

  const total =
    after === null ? await safeCount(VARIANT_COUNT_QUERY, (d: { productVariantsCount: { count: number } }) => d.productVariantsCount.count) : null;
  const { hasNextPage, endCursor } = data.productVariants.pageInfo;
  return { entries, nextCursor: hasNextPage ? endCursor : null, total, scanned: data.productVariants.nodes.length };
}

const PRODUCT_METAFIELD_SKU_QUERY = `
  query ProductMetafieldSkuPage($first: Int!, $after: String, $namespace: String!, $key: String!) {
    products(first: $first, after: $after) {
      nodes {
        id
        title
        handle
        status
        featuredImage { url }
        metafield(namespace: $namespace, key: $key) { value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** A list-type metafield stores its values as a JSON array string; a plain one is just the value. */
function metafieldSkuValues(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string").map((v) => v.trim());
    } catch {
      // not actually JSON — fall through and treat it as a literal value
    }
  }
  return [trimmed];
}

/** One page (up to 250 products — Shopify's maximum) of SKUs stored in a product metafield (e.g. a custom "SKU" metafield) instead of the variant SKU field. */
export async function fetchMetafieldSkuPage(namespace: string, key: string, after: string | null): Promise<StoreSkuPage> {
  const data: {
    products: {
      nodes: {
        id: string;
        title: string;
        handle: string;
        status: ProductStatus;
        featuredImage: { url: string } | null;
        metafield: { value: string } | null;
      }[];
      pageInfo: PageInfo;
    };
  } = await shopifyGraphQL(PRODUCT_METAFIELD_SKU_QUERY, { first: PRODUCT_PAGE_SIZE, after, namespace, key });

  const entries: StoreSkuEntry[] = [];
  for (const node of data.products.nodes) {
    if (!node.metafield?.value) continue;
    for (const sku of metafieldSkuValues(node.metafield.value)) {
      if (!sku) continue;
      entries.push({
        sku,
        productId: node.id,
        variantId: null,
        title: node.title,
        handle: node.handle,
        status: node.status,
        imageUrl: node.featuredImage?.url ?? null,
      });
    }
  }

  const total =
    after === null ? await safeCount(PRODUCT_COUNT_QUERY, (d: { productsCount: { count: number } }) => d.productsCount.count) : null;
  const { hasNextPage, endCursor } = data.products.pageInfo;
  return { entries, nextCursor: hasNextPage ? endCursor : null, total, scanned: data.products.nodes.length };
}
