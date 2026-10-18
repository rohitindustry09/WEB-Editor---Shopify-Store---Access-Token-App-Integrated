import { shopifyGraphQL } from "./client";
import { VARIANT_FIELDS } from "./products";
import type { Connection, CollectionDetail, CollectionListItem, ProductListItem, UserError } from "./types";

const COLLECTION_FIELDS = `
  id
  title
  handle
  updatedAt
  image { url altText }
  productsCount { count }
  ruleSet { appliedDisjunctively rules { column relation condition } }
`;

const COLLECTIONS_QUERY = `
  query Collections($first: Int, $last: Int, $query: String, $after: String, $before: String) {
    collections(first: $first, last: $last, query: $query, after: $after, before: $before, sortKey: TITLE) {
      nodes { ${COLLECTION_FIELDS} }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export async function getCollections(options?: {
  search?: string;
  first?: number;
  last?: number;
  after?: string;
  before?: string;
}): Promise<Connection<CollectionListItem>> {
  const usingLast = Boolean(options?.last || options?.before);
  const data = await shopifyGraphQL<{ collections: Connection<CollectionListItem> }>(
    COLLECTIONS_QUERY,
    {
      first: usingLast ? undefined : (options?.first ?? 50),
      last: usingLast ? (options?.last ?? 50) : undefined,
      query: options?.search || undefined,
      after: options?.after,
      before: options?.before,
    },
  );
  return data.collections;
}

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

const COLLECTION_QUERY = `
  query Collection($id: ID!) {
    collection(id: $id) {
      ${COLLECTION_FIELDS}
      descriptionHtml
      products(first: 100) { nodes { ${PRODUCT_FIELDS} } }
    }
  }
`;

export async function getCollection(id: string): Promise<CollectionDetail | null> {
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Collection/${id}`;
  const data = await shopifyGraphQL<{ collection: CollectionDetail | null }>(COLLECTION_QUERY, {
    id: gid,
  });
  return data.collection;
}

const COLLECTION_CREATE_MUTATION = `
  mutation CollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id title handle }
      userErrors { field message }
    }
  }
`;

export interface CollectionRuleInput {
  column: string;
  relation: string;
  condition: string;
}

export async function createCollection(input: {
  title: string;
  descriptionHtml?: string;
  productIds?: string[];
  imageUrl?: string;
  ruleSet?: { appliedDisjunctively: boolean; rules: CollectionRuleInput[] };
}): Promise<{ collection: { id: string; title: string; handle: string } | null; userErrors: UserError[] }> {
  const data = await shopifyGraphQL<{
    collectionCreate: {
      collection: { id: string; title: string; handle: string } | null;
      userErrors: UserError[];
    };
  }>(COLLECTION_CREATE_MUTATION, {
    input: {
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      products: input.ruleSet ? undefined : input.productIds,
      image: input.imageUrl ? { src: input.imageUrl } : undefined,
      ruleSet: input.ruleSet,
    },
  });
  return data.collectionCreate;
}

const ADD_PRODUCTS_MUTATION = `
  mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProductsV2(id: $id, productIds: $productIds) {
      job { id }
      userErrors { field message }
    }
  }
`;

export async function addProductsToCollection(
  collectionId: string,
  productIds: string[],
): Promise<UserError[]> {
  const data = await shopifyGraphQL<{
    collectionAddProductsV2: { userErrors: UserError[] };
  }>(ADD_PRODUCTS_MUTATION, { id: collectionId, productIds });
  return data.collectionAddProductsV2.userErrors;
}

const REMOVE_PRODUCTS_MUTATION = `
  mutation CollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
    collectionRemoveProducts(id: $id, productIds: $productIds) {
      job { id }
      userErrors { field message }
    }
  }
`;

export async function removeProductsFromCollection(
  collectionId: string,
  productIds: string[],
): Promise<UserError[]> {
  const data = await shopifyGraphQL<{
    collectionRemoveProducts: { userErrors: UserError[] };
  }>(REMOVE_PRODUCTS_MUTATION, { id: collectionId, productIds });
  return data.collectionRemoveProducts.userErrors;
}

const UPDATE_RULESET_MUTATION = `
  mutation CollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id }
      userErrors { field message }
    }
  }
`;

export async function updateCollectionRuleSet(
  collectionId: string,
  ruleSet: { appliedDisjunctively: boolean; rules: CollectionRuleInput[] },
): Promise<UserError[]> {
  const data = await shopifyGraphQL<{
    collectionUpdate: { userErrors: UserError[] };
  }>(UPDATE_RULESET_MUTATION, { input: { id: collectionId, ruleSet } });
  return data.collectionUpdate.userErrors;
}

const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($first: Int!, $query: String!) {
    products(first: $first, query: $query) { nodes { ${PRODUCT_FIELDS} } }
  }
`;

export async function searchProducts(query: string, first = 8): Promise<ProductListItem[]> {
  if (!query.trim()) return [];
  const data = await shopifyGraphQL<{ products: { nodes: ProductListItem[] } }>(
    SEARCH_PRODUCTS_QUERY,
    { first, query: `title:*${query}* OR sku:*${query}*` },
  );
  return data.products.nodes;
}
