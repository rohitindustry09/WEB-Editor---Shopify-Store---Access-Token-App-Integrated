"use server";

import type { ImageRow } from "@/lib/merchant/images";
import { shopifyGraphQL } from "@/lib/shopify/client";

// 25 products × 20 images keeps one request under Shopify's query-cost limit.
const PRODUCTS_PER_PAGE = 25;
const IMAGES_PER_PRODUCT = 20;

const MEDIA_QUERY = `
  query MerchantImages($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title vendor
        media(first: ${IMAGES_PER_PRODUCT}) {
          nodes { ... on MediaImage { id alt image { url width height } } }
        }
      }
    }
  }
`;

interface MediaNode {
  id?: string;
  alt?: string | null;
  image?: { url: string; width: number | null; height: number | null } | null;
}

export interface ImagePage {
  images: ImageRow[];
  products: number;
  nextCursor: string | null;
}

/** One page of products with their images (the first 20 of each), flattened to one row per image. */
export async function loadImagePageAction(cursor: string | null): Promise<({ ok: true } & ImagePage) | { ok: false; error: string }> {
  try {
    const data = await shopifyGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { id: string; title: string; vendor: string; media: { nodes: MediaNode[] } }[];
      };
    }>(MEDIA_QUERY, { first: PRODUCTS_PER_PAGE, after: typeof cursor === "string" ? cursor : null });

    const images: ImageRow[] = [];
    for (const product of data.products.nodes) {
      let position = 0;
      for (const node of product.media.nodes) {
        // Videos and 3D models come back as empty objects — only images are checked.
        if (!node.id || !node.image) continue;
        position += 1;
        images.push({
          fileId: node.id,
          productId: product.id,
          productTitle: product.title,
          vendor: product.vendor,
          position,
          alt: node.alt ?? "",
          url: node.image.url,
          width: node.image.width ?? 0,
          height: node.image.height ?? 0,
        });
      }
    }
    const { pageInfo } = data.products;
    return { ok: true, images, products: data.products.nodes.length, nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't read the product images." };
  }
}
