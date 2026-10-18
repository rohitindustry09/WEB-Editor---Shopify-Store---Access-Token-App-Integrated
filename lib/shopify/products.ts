import { shopifyGraphQL } from "./client";
import type { Connection, ProductDetail, ProductListItem, UserError } from "./types";

export const VARIANT_FIELDS = `
  id
  title
  sku
  price
  compareAtPrice
  barcode
  inventoryPolicy
  taxable
  inventoryQuantity
  inventoryItem {
    id
    tracked
    measurement { weight { value unit } }
  }
`;

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  vendor
  productType
  totalInventory
  images(first: 1) { nodes { id url altText } }
  variants(first: 1) { nodes { ${VARIANT_FIELDS} } }
`;

const PRODUCTS_QUERY = `
  query Products($first: Int, $last: Int, $query: String, $after: String, $before: String) {
    products(first: $first, last: $last, query: $query, after: $after, before: $before, sortKey: TITLE) {
      nodes { ${PRODUCT_FIELDS} }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export async function getProducts(options?: {
  search?: string;
  first?: number;
  last?: number;
  after?: string;
  before?: string;
}): Promise<Connection<ProductListItem>> {
  const usingLast = Boolean(options?.last || options?.before);
  const data = await shopifyGraphQL<{ products: Connection<ProductListItem> }>(
    PRODUCTS_QUERY,
    {
      first: usingLast ? undefined : (options?.first ?? 50),
      last: usingLast ? (options?.last ?? 50) : undefined,
      query: options?.search || undefined,
      after: options?.after,
      before: options?.before,
    },
  );
  return data.products;
}

const PRODUCT_QUERY = `
  query Product($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      vendor
      productType
      totalInventory
      descriptionHtml
      tags
      seo { title description }
      collections(first: 50) { nodes { id title } }
      images(first: 20) { nodes { id url altText } }
      variants(first: 1) { nodes { ${VARIANT_FIELDS} } }
    }
  }
`;

export async function getProduct(id: string): Promise<ProductDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
  const data = await shopifyGraphQL<{ product: ProductDetail | null }>(PRODUCT_QUERY, {
    id: gid,
  });
  return data.product;
}

const PRODUCT_UPDATE_MUTATION = `
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id }
      userErrors { field message }
    }
  }
`;

export async function updateProduct(input: {
  id: string;
  title?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: string;
  handle?: string;
  seo?: { title?: string; description?: string };
  templateSuffix?: string;
}): Promise<UserError[]> {
  const data = await shopifyGraphQL<{
    productUpdate: { userErrors: UserError[] };
  }>(PRODUCT_UPDATE_MUTATION, { input });
  return data.productUpdate.userErrors;
}

const ADD_MEDIA_MUTATION = `
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage { id image { url altText } }
      }
      mediaUserErrors { field message }
    }
  }
`;

export async function addProductImages(
  productId: string,
  images: { url: string; altText?: string }[],
): Promise<UserError[]> {
  const data = await shopifyGraphQL<{
    productCreateMedia: { mediaUserErrors: UserError[] };
  }>(ADD_MEDIA_MUTATION, {
    productId,
    media: images.map((img) => ({
      originalSource: img.url,
      alt: img.altText,
      mediaContentType: "IMAGE",
    })),
  });
  return data.productCreateMedia.mediaUserErrors;
}

const DELETE_MEDIA_MUTATION = `
  mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message }
    }
  }
`;

export async function deleteProductImages(
  productId: string,
  mediaIds: string[],
): Promise<UserError[]> {
  const data = await shopifyGraphQL<{
    productDeleteMedia: { mediaUserErrors: UserError[] };
  }>(DELETE_MEDIA_MUTATION, { productId, mediaIds });
  return data.productDeleteMedia.mediaUserErrors;
}

const VARIANT_UPDATE_MUTATION = `
  mutation VariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

export interface VariantUpdateInput {
  price?: string;
  compareAtPrice?: string | null;
  barcode?: string;
  taxable?: boolean;
  inventoryPolicy?: "DENY" | "CONTINUE";
  sku?: string;
  tracked?: boolean;
  weight?: number;
  weightUnit?: "GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS";
}

export async function updateVariant(
  productId: string,
  variantId: string,
  input: VariantUpdateInput,
): Promise<UserError[]> {
  const variant: Record<string, unknown> = { id: variantId };
  if (input.price !== undefined) variant.price = input.price;
  if (input.compareAtPrice !== undefined) variant.compareAtPrice = input.compareAtPrice || null;
  if (input.barcode !== undefined) variant.barcode = input.barcode;
  if (input.taxable !== undefined) variant.taxable = input.taxable;
  if (input.inventoryPolicy !== undefined) variant.inventoryPolicy = input.inventoryPolicy;
  if (input.sku !== undefined || input.tracked !== undefined || input.weight !== undefined) {
    variant.inventoryItem = {
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.tracked !== undefined ? { tracked: input.tracked } : {}),
      ...(input.weight !== undefined
        ? { measurement: { weight: { value: input.weight, unit: input.weightUnit ?? "GRAMS" } } }
        : {}),
    };
  }

  const data = await shopifyGraphQL<{
    productVariantsBulkUpdate: { userErrors: UserError[] };
  }>(VARIANT_UPDATE_MUTATION, {
    productId,
    variants: [variant],
  });
  return data.productVariantsBulkUpdate.userErrors;
}

export async function updateVariantPrice(
  productId: string,
  variantId: string,
  price: string,
): Promise<UserError[]> {
  return updateVariant(productId, variantId, { price });
}

const PRODUCT_CREATE_MUTATION = `
  mutation ProductCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        handle
        variants(first: 1) { nodes { id } }
      }
      userErrors { field message }
    }
  }
`;

export interface CreateProductInput {
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: "ACTIVE" | "DRAFT";
  price?: string;
  compareAtPrice?: string;
  sku?: string;
  barcode?: string;
  tracked?: boolean;
  weight?: number;
  weightUnit?: "GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS";
  taxable?: boolean;
  inventoryPolicy?: "DENY" | "CONTINUE";
  collectionIds?: string[];
  imageUrls?: string[];
}

export async function createProduct(
  input: CreateProductInput,
): Promise<{ id: string | null; handle: string | null; userErrors: UserError[] }> {
  const data = await shopifyGraphQL<{
    productCreate: {
      product: { id: string; handle: string; variants: { nodes: { id: string }[] } } | null;
      userErrors: UserError[];
    };
  }>(PRODUCT_CREATE_MUTATION, {
    input: {
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      vendor: input.vendor || undefined,
      productType: input.productType || undefined,
      tags: input.tags,
      status: input.status ?? "DRAFT",
      collectionsToJoin: input.collectionIds,
      images: input.imageUrls?.filter(Boolean).map((src) => ({ src })),
    },
  });

  const errors = data.productCreate.userErrors;
  const product = data.productCreate.product;

  if (product) {
    const variantId = product.variants.nodes[0]?.id;
    const hasVariantFields =
      input.price !== undefined ||
      input.compareAtPrice !== undefined ||
      input.sku !== undefined ||
      input.barcode !== undefined ||
      input.tracked !== undefined ||
      input.weight !== undefined ||
      input.taxable !== undefined ||
      input.inventoryPolicy !== undefined;

    if (variantId && hasVariantFields) {
      const variantErrors = await updateVariant(product.id, variantId, {
        price: input.price,
        compareAtPrice: input.compareAtPrice,
        sku: input.sku,
        barcode: input.barcode,
        tracked: input.tracked,
        weight: input.weight,
        weightUnit: input.weightUnit,
        taxable: input.taxable,
        inventoryPolicy: input.inventoryPolicy,
      });
      errors.push(...variantErrors);
    }
  }

  return { id: product?.id ?? null, handle: product?.handle ?? null, userErrors: errors };
}

const PRODUCTS_COUNT_QUERY = `
  query ProductsCount($query: String) {
    productsCount(query: $query) { count }
  }
`;

export async function getProductStats(): Promise<{ active: number; draft: number; outOfStock: number }> {
  const [active, draft, outOfStock] = await Promise.all([
    shopifyGraphQL<{ productsCount: { count: number } }>(PRODUCTS_COUNT_QUERY, { query: "status:active" }),
    shopifyGraphQL<{ productsCount: { count: number } }>(PRODUCTS_COUNT_QUERY, { query: "status:draft" }),
    shopifyGraphQL<{ productsCount: { count: number } }>(PRODUCTS_COUNT_QUERY, { query: "inventory_total:0" }),
  ]);
  return { active: active.productsCount.count, draft: draft.productsCount.count, outOfStock: outOfStock.productsCount.count };
}

const VENDORS_QUERY = `
  query ProductVendors($first: Int!, $query: String) {
    productVendors(first: $first, query: $query)
  }
`;

export async function getProductVendors(search?: string): Promise<string[]> {
  const data = await shopifyGraphQL<{ productVendors: string[] }>(VENDORS_QUERY, {
    first: 20,
    query: search || undefined,
  });
  return data.productVendors;
}

const TYPES_QUERY = `
  query ProductTypes($first: Int!, $query: String) {
    productTypes(first: $first, query: $query)
  }
`;

export async function getProductTypes(search?: string): Promise<string[]> {
  const data = await shopifyGraphQL<{ productTypes: string[] }>(TYPES_QUERY, {
    first: 20,
    query: search || undefined,
  });
  return data.productTypes;
}

const TAGS_QUERY = `
  query ProductTags($first: Int!, $search: String) {
    productTags(first: $first, search: $search) {
      nodes
    }
  }
`;

export async function getProductTags(search?: string): Promise<string[]> {
  const data = await shopifyGraphQL<{ productTags: { nodes: string[] } }>(TAGS_QUERY, {
    first: 20,
    search: search || undefined,
  });
  return data.productTags.nodes;
}

const PRODUCT_CURRENT_TAGS_QUERY = `
  query ProductCurrentTags($id: ID!) {
    product(id: $id) { tags }
  }
`;

/** A single product's current tag list — used to skip products that already have every tag a bulk-insert row is about to add. */
export async function getProductCurrentTags(productId: string): Promise<string[]> {
  const data = await shopifyGraphQL<{ product: { tags: string[] } | null }>(PRODUCT_CURRENT_TAGS_QUERY, {
    id: productId,
  });
  return data.product?.tags ?? [];
}

const TAGS_ADD_MUTATION = `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

/** Adds tags to a product without touching any tag already there — `tagsAdd` merges, unlike `productUpdate`'s full-replace `tags` field. */
export async function addProductTags(productId: string, tags: string[]): Promise<{ ok: boolean; error?: string }> {
  const data = await shopifyGraphQL<{
    tagsAdd: { node: { id: string } | null; userErrors: UserError[] };
  }>(TAGS_ADD_MUTATION, { id: productId, tags });

  const errors = data.tagsAdd.userErrors;
  if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join(" ") };
  return { ok: true };
}

/**
 * Resolves a batch of pasted SKUs/product IDs against the live catalog in a
 * single request, used by the bulk collection builder to avoid N+1 lookups.
 */
export async function resolveProductIdentifiers(
  identifiers: string[],
): Promise<{ raw: string; product: ProductListItem | null }[]> {
  if (identifiers.length === 0) return [];

  const gidCandidates = identifiers.filter((id) => /^\d+$/.test(id) || id.startsWith("gid://"));
  const skuCandidates = identifiers.filter((id) => !/^\d+$/.test(id) && !id.startsWith("gid://"));

  const found = new Map<string, ProductListItem>();

  if (skuCandidates.length > 0) {
    const clauses = skuCandidates.map((sku) => `sku:'${sku.replace(/'/g, "")}'`);
    const query = clauses.join(" OR ");
    const data = await shopifyGraphQL<{ products: Connection<ProductListItem> }>(
      `query ResolveBySku($first: Int!, $query: String!) {
        products(first: $first, query: $query) { nodes { ${PRODUCT_FIELDS} } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
      }`,
      { first: Math.min(skuCandidates.length * 2, 250), query },
    );
    for (const product of data.products.nodes) {
      for (const variant of product.variants.nodes) {
        found.set(variant.sku.toLowerCase(), product);
      }
    }
  }

  const idResults = await Promise.all(
    gidCandidates.map(async (raw) => {
      const gid = raw.startsWith("gid://") ? raw : `gid://shopify/Product/${raw}`;
      const product = await getProduct(gid).catch(() => null);
      return { raw, product };
    }),
  );

  return identifiers.map((raw) => {
    const bySku = found.get(raw.toLowerCase());
    if (bySku) return { raw, product: bySku };
    const byId = idResults.find((r) => r.raw === raw);
    return { raw, product: byId?.product ?? null };
  });
}
