import { shopifyGraphQL } from "./client";
import type { UserError } from "./types";
import type { ProductStatus } from "./taxonomy";

export interface ProductContentSnapshot {
  id: string;
  title: string;
  descriptionHtml: string;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  status: ProductStatus;
  categoryName: string | null;
}

const PRODUCT_CONTENT_SNAPSHOT_QUERY = `
  query ProductContentSnapshot($id: ID!) {
    product(id: $id) {
      id
      title
      descriptionHtml
      tags
      status
      seo { title description }
      category { fullName }
    }
  }
`;

/** A small, purpose-built query for this tool — the product detail page's query pulls in images/variants/collections this feature never needs. */
export async function getProductContentSnapshot(productId: string): Promise<ProductContentSnapshot | null> {
  const data = await shopifyGraphQL<{
    product: {
      id: string;
      title: string;
      descriptionHtml: string;
      tags: string[];
      status: ProductStatus;
      seo: { title: string | null; description: string | null };
      category: { fullName: string } | null;
    } | null;
  }>(PRODUCT_CONTENT_SNAPSHOT_QUERY, { id: productId });

  if (!data.product) return null;
  return {
    id: data.product.id,
    title: data.product.title,
    descriptionHtml: data.product.descriptionHtml,
    tags: data.product.tags,
    seoTitle: data.product.seo.title,
    seoDescription: data.product.seo.description,
    status: data.product.status,
    categoryName: data.product.category?.fullName ?? null,
  };
}

const PRODUCT_CONTENT_UPDATE_MUTATION = `
  mutation ProductContentUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      userErrors { field message }
    }
  }
`;

export interface ProductContentUpdateInput {
  title?: string;
  descriptionHtml?: string;
  /** Full replace, same as editing tags on the product page directly — not additive like the bulk tag-insert tool. */
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
}

/**
 * Writes only the fields present on `fields` — a field simply absent from
 * the object is left untouched on the product, same semantics as Shopify's
 * own partial `ProductInput`.
 */
export async function updateProductContent(
  productId: string,
  fields: ProductContentUpdateInput,
): Promise<{ ok: boolean; error?: string }> {
  const input: Record<string, unknown> = { id: productId };
  if (fields.title !== undefined) input.title = fields.title;
  if (fields.descriptionHtml !== undefined) input.descriptionHtml = fields.descriptionHtml;
  if (fields.tags !== undefined) input.tags = fields.tags;
  if (fields.seoTitle !== undefined || fields.seoDescription !== undefined) {
    const seo: Record<string, string> = {};
    if (fields.seoTitle !== undefined) seo.title = fields.seoTitle;
    if (fields.seoDescription !== undefined) seo.description = fields.seoDescription;
    input.seo = seo;
  }

  try {
    const data = await shopifyGraphQL<{ productUpdate: { userErrors: UserError[] } }>(
      PRODUCT_CONTENT_UPDATE_MUTATION,
      { input },
    );
    const errors = data.productUpdate.userErrors;
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join(", ") };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update this product." };
  }
}
