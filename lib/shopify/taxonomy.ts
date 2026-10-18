import { shopifyGraphQL } from "./client";

export interface ProductCategory {
  id: string;
  name: string;
  fullName: string;
  isLeaf: boolean;
}

const PRODUCT_CATEGORY_QUERY = `
  query ProductCategoryDiagnostic($id: ID!) {
    product(id: $id) {
      id
      title
      category {
        id
        name
        fullName
        isLeaf
      }
    }
  }
`;

export async function getProductCategory(
  productId: string,
): Promise<{ title: string; category: ProductCategory | null }> {
  const gid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
  const data = await shopifyGraphQL<{
    product: { id: string; title: string; category: ProductCategory | null } | null;
  }>(PRODUCT_CATEGORY_QUERY, { id: gid });
  if (!data.product) throw new Error("Product not found.");
  return { title: data.product.title, category: data.product.category };
}

export interface TaxonomyAttribute {
  id: string;
  name: string;
  typename: string;
}

const CATEGORY_ATTRIBUTES_QUERY = `
  query CategoryAttributesDiagnostic($id: ID!) {
    node(id: $id) {
      ... on TaxonomyCategory {
        id
        name
        attributes(first: 50) {
          nodes {
            __typename
            ... on TaxonomyChoiceListAttribute { id name }
            ... on TaxonomyMeasurementAttribute { id name }
          }
        }
      }
    }
  }
`;

export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

export interface SkuMatch {
  id: string;
  title: string;
  sku: string;
  image: { url: string; altText: string | null } | null;
  category: ProductCategory | null;
  status: ProductStatus;
  /**
   * "exact" — the title matched the CSV identifier exactly (case-insensitive).
   * "prefix" — one title starts with the other and the extra text begins at a
   * word boundary (space/hyphen/etc.), e.g. a base name like "REBUKE HOCKEY
   * GLOVE" matching separate variant-per-color products "REBUKE HOCKEY GLOVE
   * Right" / "...Left". Only produced by `searchProductsByTitle`.
   */
  matchType: "exact" | "prefix";
}

/**
 * True when `longer` starts with `shorter` (case-insensitive) AND the text
 * immediately following that prefix is a word boundary — a space, hyphen, or
 * similar separator, or nothing at all. This is what lets a base product
 * name like "REBUKE HOCKEY GLOVE" match store variants named "REBUKE HOCKEY
 * GLOVE Right" without also matching an unrelated "REBUKE HOCKEY GLOVEBAG".
 */
function startsWithAtWordBoundary(longer: string, shorter: string): boolean {
  if (!longer.toLowerCase().startsWith(shorter.toLowerCase())) return false;
  const rest = longer.slice(shorter.length);
  return rest.length === 0 || /^[\s\-–—,/|.]/.test(rest);
}

function titleMatchType(a: string, b: string): "exact" | "prefix" | null {
  const left = a.trim();
  const right = b.trim();
  if (left.toLowerCase() === right.toLowerCase()) return "exact";
  if (startsWithAtWordBoundary(left, right) || startsWithAtWordBoundary(right, left)) return "prefix";
  return null;
}

const SEARCH_BY_SKU_QUERY = `
  query ProductsBySku($query: String!) {
    products(first: 10, query: $query) {
      nodes {
        id
        title
        status
        images(first: 1) { nodes { url altText } }
        category { id name fullName isLeaf }
        variants(first: 5) { nodes { sku } }
      }
    }
  }
`;

/**
 * Exact (case-insensitive) SKU match — Shopify's `sku:` search filter is
 * tokenized/fuzzy, so results are post-filtered here rather than trusting it
 * to only return products actually carrying this SKU. Only the query string
 * sent to Shopify is stripped of characters that would break its search
 * syntax (e.g. an apostrophe closing the quoted phrase early); the exact
 * match itself always compares against the untouched, original SKU so a
 * real SKU containing that character still matches correctly.
 */
export async function searchProductsBySku(sku: string): Promise<SkuMatch[]> {
  const trimmed = sku.trim();
  if (!trimmed) return [];
  const queryValue = trimmed.replace(/'/g, "");
  const data = await shopifyGraphQL<{
    products: {
      nodes: {
        id: string;
        title: string;
        status: ProductStatus;
        images: { nodes: { url: string; altText: string | null }[] };
        category: ProductCategory | null;
        variants: { nodes: { sku: string | null }[] };
      }[];
    };
  }>(SEARCH_BY_SKU_QUERY, { query: `sku:'${queryValue}'` });

  return data.products.nodes
    .filter((p) => p.variants.nodes.some((v) => (v.sku ?? "").trim().toLowerCase() === trimmed.toLowerCase()))
    .map((p) => ({
      id: p.id,
      title: p.title,
      sku:
        p.variants.nodes.find((v) => (v.sku ?? "").trim().toLowerCase() === trimmed.toLowerCase())?.sku ??
        trimmed,
      image: p.images.nodes[0] ?? null,
      category: p.category,
      status: p.status,
      matchType: "exact" as const,
    }));
}

const SEARCH_BY_TITLE_QUERY = `
  query ProductsByTitle($query: String!) {
    products(first: 25, query: $query) {
      nodes {
        id
        title
        status
        images(first: 1) { nodes { url altText } }
        category { id name fullName isLeaf }
        variants(first: 1) { nodes { sku } }
      }
    }
  }
`;

/**
 * Title match — Shopify's `title:` search filter is tokenized/fuzzy, so
 * results are post-filtered here rather than trusting it to only return
 * products actually named this. Only the query string sent to Shopify is
 * stripped of characters that would break its search syntax; matching itself
 * always compares against the untouched, original title.
 *
 * Two kinds of match are accepted:
 * - "exact": the title matches the CSV identifier exactly (case-insensitive).
 * - "prefix": one title starts with the other and the extra text begins at a
 *   word boundary — this is what lets a base name like "REBUKE HOCKEY GLOVE"
 *   in the CSV match separate per-variant store products such as "REBUKE
 *   HOCKEY GLOVE Right" / "...Left", or a CSV title with extra trailing text
 *   like "DIVOX Black" + something match the shorter real product title.
 *
 * More than one product can legitimately match (variant families, or
 * multiple products sharing a title).
 */
export async function searchProductsByTitle(title: string): Promise<SkuMatch[]> {
  const trimmed = title.trim();
  if (!trimmed) return [];
  const queryValue = trimmed.replace(/'/g, "");
  const data = await shopifyGraphQL<{
    products: {
      nodes: {
        id: string;
        title: string;
        status: ProductStatus;
        images: { nodes: { url: string; altText: string | null }[] };
        category: ProductCategory | null;
        variants: { nodes: { sku: string | null }[] };
      }[];
    };
  }>(SEARCH_BY_TITLE_QUERY, { query: `title:'${queryValue}'` });

  return data.products.nodes
    .map((p) => ({ product: p, matchType: titleMatchType(p.title, trimmed) }))
    .filter((r): r is { product: (typeof data.products.nodes)[number]; matchType: "exact" | "prefix" } =>
      r.matchType !== null,
    )
    .map(({ product: p, matchType }) => ({
      id: p.id,
      title: p.title,
      sku: p.variants.nodes[0]?.sku ?? "",
      image: p.images.nodes[0] ?? null,
      category: p.category,
      status: p.status,
      matchType,
    }));
}

export async function getCategoryAttributes(categoryId: string): Promise<TaxonomyAttribute[]> {
  const data = await shopifyGraphQL<{
    node: {
      id: string;
      name: string;
      attributes: { nodes: { __typename: string; id: string | null; name: string | null }[] };
    } | null;
  }>(CATEGORY_ATTRIBUTES_QUERY, { id: categoryId });
  const category = data.node;
  if (!category) throw new Error("Couldn't load attributes for this category.");
  // Attribute subtypes beyond the two fragments above (e.g. a boolean
  // attribute) come back with id/name unset rather than erroring — skip
  // those instead of producing a null name.
  return category.attributes.nodes
    .filter((n): n is { __typename: string; id: string; name: string } => Boolean(n.id && n.name))
    .map((n) => ({ id: n.id, name: n.name, typename: n.__typename }));
}
