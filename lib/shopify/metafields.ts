import { shopifyGraphQL } from "./client";
import type { ProductStatus } from "./types";

/** One product metafield *definition* configured for the store's Product resource — the schema, not any particular product's value. */
export interface MetafieldDefinitionSummary {
  id: string;
  name: string;
  namespace: string;
  key: string;
  typeName: string;
  description: string | null;
}

const METAFIELD_DEFINITIONS_QUERY = `
  query ProductMetafieldDefinitions($first: Int!) {
    metafieldDefinitions(first: $first, ownerType: PRODUCT) {
      nodes {
        id
        name
        namespace
        key
        description
        type { name }
      }
    }
  }
`;

/** Every metafield definition set up for products in this store — not scoped to any one product. */
export async function getProductMetafieldDefinitions(): Promise<MetafieldDefinitionSummary[]> {
  const data = await shopifyGraphQL<{
    metafieldDefinitions: {
      nodes: { id: string; name: string; namespace: string; key: string; description: string | null; type: { name: string } }[];
    };
  }>(METAFIELD_DEFINITIONS_QUERY, { first: 250 });

  return data.metafieldDefinitions.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    namespace: n.namespace,
    key: n.key,
    typeName: n.type.name,
    description: n.description,
  }));
}

export interface MetafieldCopierProduct {
  id: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  status: ProductStatus;
}

export interface SourceProductSummary extends MetafieldCopierProduct {
  description: string;
  categoryName: string | null;
}

const SOURCE_PRODUCT_QUERY = `
  query MetafieldCopierSourceProduct($id: ID!) {
    product(id: $id) {
      id
      title
      description
      status
      category { fullName }
      featuredImage { url }
      variants(first: 1) { nodes { sku } }
    }
  }
`;

/** The compact summary row shown once a source product is picked — image, title, sku, description, category, status. */
export async function getSourceProductSummary(productId: string): Promise<SourceProductSummary | null> {
  const data = await shopifyGraphQL<{
    product: {
      id: string;
      title: string;
      description: string;
      status: ProductStatus;
      category: { fullName: string } | null;
      featuredImage: { url: string } | null;
      variants: { nodes: { sku: string | null }[] };
    } | null;
  }>(SOURCE_PRODUCT_QUERY, { id: productId });

  const p = data.product;
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    status: p.status,
    categoryName: p.category?.fullName ?? null,
    imageUrl: p.featuredImage?.url ?? null,
    sku: p.variants.nodes[0]?.sku ?? null,
  };
}

/** One resolved item behind a reference-type metafield (product/collection/file/variant references) — enough to render a thumbnail and a title instead of a raw GID. */
export interface MetafieldReferenceItem {
  id: string;
  title: string;
  imageUrl: string | null;
}

export interface ProductMetafieldValue {
  id: string;
  value: string;
  type: string;
  /** Resolved product/collection/file/variant references, if this metafield's type is a reference type — empty for plain scalar metafields. */
  referencedItems: MetafieldReferenceItem[];
}

// Covers every reference metafield type this tool renders thumbnails for.
// `... on Node` fields would work too, but naming the concrete types keeps
// the exact fields (image, title) each one needs.
const METAFIELD_REFERENCE_FRAGMENT = `
  __typename
  ... on Product { id title featuredImage { url } }
  ... on Collection { id title image { url } }
  ... on MediaImage { id image { url } }
  ... on GenericFile { id url }
  ... on ProductVariant { id title image { url } product { title } }
`;

const PRODUCT_METAFIELD_VALUE_QUERY = `
  query ProductMetafieldValue($id: ID!, $namespace: String!, $key: String!) {
    product(id: $id) {
      metafield(namespace: $namespace, key: $key) {
        id
        value
        type
        reference { ${METAFIELD_REFERENCE_FRAGMENT} }
        references(first: 50) { nodes { ${METAFIELD_REFERENCE_FRAGMENT} } }
      }
    }
  }
`;

interface MetafieldReferenceNode {
  __typename: string;
  id: string;
  title?: string;
  featuredImage?: { url: string } | null;
  image?: { url: string } | null;
  url?: string;
  product?: { title: string } | null;
}

function toReferenceItem(node: MetafieldReferenceNode): MetafieldReferenceItem {
  switch (node.__typename) {
    case "Product":
      return { id: node.id, title: node.title ?? "Untitled product", imageUrl: node.featuredImage?.url ?? null };
    case "Collection":
      return { id: node.id, title: node.title ?? "Untitled collection", imageUrl: node.image?.url ?? null };
    case "MediaImage":
      return { id: node.id, title: "Image", imageUrl: node.image?.url ?? null };
    case "ProductVariant":
      return {
        id: node.id,
        title: node.product ? `${node.product.title} — ${node.title}` : (node.title ?? "Variant"),
        imageUrl: node.image?.url ?? null,
      };
    case "GenericFile":
      return { id: node.id, title: node.url?.split("/").pop() ?? "File", imageUrl: null };
    default:
      return { id: node.id, title: node.__typename, imageUrl: null };
  }
}

/** A specific product's value for one metafield definition, or null if it isn't set on this product. */
export async function getProductMetafieldValue(
  productId: string,
  namespace: string,
  key: string,
): Promise<ProductMetafieldValue | null> {
  const data = await shopifyGraphQL<{
    product: {
      metafield: {
        id: string;
        value: string;
        type: string;
        reference: MetafieldReferenceNode | null;
        references: { nodes: MetafieldReferenceNode[] } | null;
      } | null;
    } | null;
  }>(PRODUCT_METAFIELD_VALUE_QUERY, { id: productId, namespace, key });

  const mf = data.product?.metafield;
  if (!mf) return null;

  const referencedItems = mf.references
    ? mf.references.nodes.map(toReferenceItem)
    : mf.reference
      ? [toReferenceItem(mf.reference)]
      : [];

  return { id: mf.id, value: mf.value, type: mf.type, referencedItems };
}

const PRODUCT_PICKER_FIELDS = `
  id
  title
  status
  featuredImage { url }
  variants(first: 1) { nodes { sku } }
`;

function toPickerProduct(node: {
  id: string;
  title: string;
  status: ProductStatus;
  featuredImage: { url: string } | null;
  variants: { nodes: { sku: string | null }[] };
}): MetafieldCopierProduct {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    imageUrl: node.featuredImage?.url ?? null,
    sku: node.variants.nodes[0]?.sku ?? null,
  };
}

const SEARCH_PRODUCTS_FOR_PICKER_QUERY = `
  query SearchProductsForMetafieldCopier($first: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: TITLE) { nodes { ${PRODUCT_PICKER_FIELDS} } }
  }
`;

const PRODUCT_BY_ID_FOR_PICKER_QUERY = `
  query ProductByIdForMetafieldCopier($id: ID!) {
    product(id: $id) { ${PRODUCT_PICKER_FIELDS} }
  }
`;

type PickerProductNode = {
  id: string;
  title: string;
  status: ProductStatus;
  featuredImage: { url: string } | null;
  variants: { nodes: { sku: string | null }[] };
};

/**
 * Direct lookup by numeric ID — Shopify's product *search index* doesn't
 * reliably support an `id:` text filter (it can miss or lag), so a raw
 * numeric ID is looked up straight via `product(id:)` instead, same as
 * every other product-by-id fetch in this app. Returns null rather than
 * throwing when the id is well-formed but doesn't match any product.
 */
async function getProductByLegacyId(numericId: string): Promise<MetafieldCopierProduct | null> {
  const data = await shopifyGraphQL<{ product: PickerProductNode | null }>(PRODUCT_BY_ID_FOR_PICKER_QUERY, {
    id: `gid://shopify/Product/${numericId}`,
  });
  return data.product ? toPickerProduct(data.product) : null;
}

/**
 * Product search for the target picker — matches title and SKU via
 * Shopify's search index, plus (when the query is purely numeric) a direct
 * ID lookup, same as Shopify's own admin search. An empty query just
 * browses the catalog alphabetically instead of returning nothing.
 */
export async function searchProductsForMetafieldCopier(query: string, first = 30): Promise<MetafieldCopierProduct[]> {
  const trimmed = query.trim();
  const results: MetafieldCopierProduct[] = [];
  const seen = new Set<string>();

  if (/^\d+$/.test(trimmed)) {
    try {
      const direct = await getProductByLegacyId(trimmed);
      if (direct) {
        results.push(direct);
        seen.add(direct.id);
      }
    } catch {
      // not a valid product id — fall through to the text search below
    }
  }

  const shopifyQuery = trimmed ? `title:*${trimmed.replace(/'/g, "")}* OR sku:*${trimmed.replace(/'/g, "")}*` : undefined;
  const data = await shopifyGraphQL<{ products: { nodes: PickerProductNode[] } }>(SEARCH_PRODUCTS_FOR_PICKER_QUERY, {
    first,
    query: shopifyQuery,
  });
  for (const node of data.products.nodes) {
    const product = toPickerProduct(node);
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    results.push(product);
  }
  return results;
}

/** Exact SKU lookups for the picker's comma-separated "SKU1, SKU2, …" paste field — one product search per SKU, since SKUs aren't guaranteed unique. */
export async function findProductsBySkuList(skus: string[]): Promise<MetafieldCopierProduct[]> {
  const results: MetafieldCopierProduct[] = [];
  const seen = new Set<string>();
  for (const sku of skus) {
    const trimmed = sku.trim().replace(/'/g, "");
    if (!trimmed) continue;
    const data = await shopifyGraphQL<{
      products: {
        nodes: { id: string; title: string; status: ProductStatus; featuredImage: { url: string } | null; variants: { nodes: { sku: string | null }[] } }[];
      };
    }>(SEARCH_PRODUCTS_FOR_PICKER_QUERY, { first: 10, query: `sku:'${trimmed}'` });
    for (const node of data.products.nodes) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      results.push(toPickerProduct(node));
    }
  }
  return results;
}

const PRODUCTS_BY_IDS_QUERY = `
  query ProductsByIdsForMetafieldCopier($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Product { ${PRODUCT_PICKER_FIELDS} }
    }
  }
`;

/**
 * Full picker rows (title, status, image, sku) for a known set of product
 * IDs — used to turn a `product_reference`/`list.product_reference`
 * metafield's already-resolved references into pre-selected picker rows,
 * without re-searching for them. Non-Product nodes (a stale/deleted id, or
 * one that resolves to something else) are silently skipped.
 */
export async function getProductsByIds(ids: string[]): Promise<MetafieldCopierProduct[]> {
  if (ids.length === 0) return [];
  const data = await shopifyGraphQL<{ nodes: ((PickerProductNode & { __typename: string }) | null)[] }>(
    PRODUCTS_BY_IDS_QUERY,
    { ids },
  );
  return data.nodes
    .filter((n): n is PickerProductNode & { __typename: string } => n !== null && n.__typename === "Product")
    .map(toPickerProduct);
}

const METAFIELDS_SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;

const METAFIELDS_PER_CALL = 25;

/**
 * Writes several metafields on one product in as few calls as Shopify allows
 * (25 per call) — one round trip instead of one per metafield. Returns a
 * readable "namespace.key: reason" per failure; empty means everything saved.
 */
export async function setProductMetafields(
  productId: string,
  metafields: { namespace: string; key: string; type: string; value: string }[],
): Promise<string[]> {
  const problems: string[] = [];
  for (let start = 0; start < metafields.length; start += METAFIELDS_PER_CALL) {
    const chunk = metafields.slice(start, start + METAFIELDS_PER_CALL);
    const data = await shopifyGraphQL<{
      metafieldsSet: { userErrors: { field: string[] | null; message: string }[] };
    }>(METAFIELDS_SET_MUTATION, {
      metafields: chunk.map((m) => ({ ownerId: productId, namespace: m.namespace, key: m.key, type: m.type, value: m.value })),
    });
    for (const error of data.metafieldsSet.userErrors) {
      // field is ["metafields", "<index>", "value"] — the index says which one of this call's metafields was rejected.
      const index = Number(error.field?.[1]);
      const which = Number.isInteger(index) && chunk[index] ? `${chunk[index].namespace}.${chunk[index].key}` : "metafield";
      problems.push(`${which}: ${error.message}`);
    }
  }
  return problems;
}

/** Writes one metafield value to one product — kept single-target (rather than Shopify's 25-per-call batch limit) so the caller can show real per-product progress as each write actually completes. */
export async function setProductMetafield(
  productId: string,
  namespace: string,
  key: string,
  type: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const data = await shopifyGraphQL<{
    metafieldsSet: {
      metafields: { id: string }[];
      userErrors: { field: string[] | null; message: string; code?: string }[];
    };
  }>(METAFIELDS_SET_MUTATION, {
    metafields: [{ ownerId: productId, namespace, key, type, value }],
  });

  const errors = data.metafieldsSet.userErrors;
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => e.message).join(" ") };
  }
  return { ok: true };
}
