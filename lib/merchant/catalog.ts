import { shopifyGraphQL } from "@/lib/shopify/client";
import type { CatalogFilter, CatalogPage, CatalogRow } from "./types";

const PAGE_SIZE = 100;

const CATALOG_QUERY = `
  query MerchantCatalog($first: Int!, $after: String, $query: String) {
    productVariants(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title sku barcode price compareAtPrice inventoryQuantity
        inventoryItem { tracked }
        product {
          id title handle vendor productType tags status description
          seo { title description }
          mediaCount { count }
        }
      }
    }
  }
`;

interface VariantNode {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryItem: { tracked: boolean } | null;
  product: {
    id: string;
    title: string;
    handle: string;
    vendor: string;
    productType: string;
    tags: string[];
    status: CatalogRow["status"];
    description: string;
    seo: { title: string | null; description: string | null };
    mediaCount: { count: number } | null;
  };
}

/** A search term safe to put inside quotes in Shopify's search syntax. */
const quote = (text: string): string => `"${text.replace(/["\\]/g, "")}"`;

/** Shopify's product-variant search string for a filter; empty means "everything". */
export function catalogQuery(filter: CatalogFilter): string {
  const parts: string[] = [];
  if (filter.tag?.trim()) parts.push(`tag:${quote(filter.tag.trim())}`);
  if (filter.vendor?.trim()) parts.push(`vendor:${quote(filter.vendor.trim())}`);
  if (filter.productType?.trim()) parts.push(`product_type:${quote(filter.productType.trim())}`);
  if (filter.status) parts.push(`product_status:${filter.status.toLowerCase()}`);
  // SKU is a prefix search; only characters SKUs are made of are kept so the term cannot alter the query.
  const sku = filter.sku?.trim().replace(/[^A-Za-z0-9_.-]/g, "");
  if (sku) parts.push(`sku:${sku}*`);
  return parts.join(" ");
}

function toRow(node: VariantNode): CatalogRow {
  const tracked = node.inventoryItem?.tracked ?? false;
  return {
    variantId: node.id,
    productId: node.product.id,
    productTitle: node.product.title,
    variantTitle: node.title === "Default Title" ? "" : node.title,
    handle: node.product.handle,
    sku: (node.sku ?? "").trim(),
    barcode: (node.barcode ?? "").trim(),
    price: node.price,
    compareAtPrice: node.compareAtPrice,
    stock: tracked ? (node.inventoryQuantity ?? 0) : null,
    tracked,
    vendor: node.product.vendor,
    productType: node.product.productType,
    tags: node.product.tags,
    status: node.product.status,
    descriptionText: node.product.description,
    seoTitle: node.product.seo.title ?? "",
    seoDescription: node.product.seo.description ?? "",
    imageCount: node.product.mediaCount?.count ?? 0,
  };
}

/** One page (up to 100 variants) of the catalog, with the cursor for the next. */
export async function fetchCatalogPage(cursor: string | null, filter: CatalogFilter): Promise<CatalogPage> {
  const data = await shopifyGraphQL<{ productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: VariantNode[] } }>(CATALOG_QUERY, {
    first: PAGE_SIZE,
    after: cursor,
    query: catalogQuery(filter) || null,
  });
  const { pageInfo, nodes } = data.productVariants;
  return { rows: nodes.map(toRow), nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null };
}
