import { shopifyGraphQL } from "./client";
import type { UserError } from "./types";

export interface StagedUploadTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

const STAGED_UPLOADS_CREATE_MUTATION = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

/** Requests one signed upload target per file — the actual bytes are then POSTed straight from the browser to `url`. */
export async function createStagedUploads(
  files: { filename: string; mimeType: string; fileSize: string }[],
): Promise<{ ok: boolean; targets: StagedUploadTarget[]; error?: string }> {
  const data = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: StagedUploadTarget[] | null;
      userErrors: UserError[];
    };
  }>(STAGED_UPLOADS_CREATE_MUTATION, {
    input: files.map((f) => ({
      resource: "IMAGE",
      filename: f.filename,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      httpMethod: "POST",
    })),
  });

  const errors = data.stagedUploadsCreate.userErrors;
  if (errors.length > 0) {
    return { ok: false, targets: [], error: errors.map((e) => e.message).join("; ") };
  }
  return { ok: true, targets: data.stagedUploadsCreate.stagedTargets ?? [] };
}

const EXISTING_MEDIA_QUERY = `
  query ExistingProductMedia($id: ID!) {
    product(id: $id) {
      media(first: 100) {
        nodes {
          id
          ... on MediaImage { image { url } }
        }
      }
    }
  }
`;

export interface ExistingMediaItem {
  id: string;
  url: string;
}

/** Reads the images a product already has, so callers can display/skip/replace/reorder instead of always adding — best-effort, never throws. */
export async function getExistingProductMedia(productId: string): Promise<{ count: number; media: ExistingMediaItem[] }> {
  try {
    const data = await shopifyGraphQL<{
      product: { media: { nodes: { id: string; image?: { url: string } | null }[] } } | null;
    }>(EXISTING_MEDIA_QUERY, { id: productId });
    const media = (data.product?.media.nodes ?? [])
      .filter((n): n is { id: string; image: { url: string } } => Boolean(n.image?.url))
      .map((n) => ({ id: n.id, url: n.image.url }));
    return { count: media.length, media };
  } catch {
    return { count: 0, media: [] };
  }
}

const PRODUCT_DELETE_MEDIA_MUTATION = `
  mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message }
    }
  }
`;

/** Removes a product's existing media — used by "replace" mode before attaching the freshly uploaded set. */
export async function deleteProductMedia(productId: string, mediaIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (mediaIds.length === 0) return { ok: true };
  const data = await shopifyGraphQL<{
    productDeleteMedia: {
      deletedMediaIds: string[] | null;
      mediaUserErrors: UserError[];
    };
  }>(PRODUCT_DELETE_MEDIA_MUTATION, { productId, mediaIds });

  const errors = data.productDeleteMedia.mediaUserErrors;
  if (errors.length > 0) {
    return { ok: false, error: errors.map((e) => e.message).join("; ") };
  }
  return { ok: true };
}

const PRODUCT_CREATE_MEDIA_MUTATION = `
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id }
      mediaUserErrors { field message }
    }
  }
`;

/** Attaches already-uploaded staged files (by their resourceUrl) to a product as image media, with per-image alt text. */
export async function attachProductMedia(
  productId: string,
  files: { resourceUrl: string; alt: string }[],
): Promise<{ ok: boolean; mediaIds: string[]; error?: string }> {
  const data = await shopifyGraphQL<{
    productCreateMedia: {
      media: { id: string }[] | null;
      mediaUserErrors: UserError[];
    };
  }>(PRODUCT_CREATE_MEDIA_MUTATION, {
    productId,
    media: files.map((f) => ({ originalSource: f.resourceUrl, alt: f.alt, mediaContentType: "IMAGE" })),
  });

  const errors = data.productCreateMedia.mediaUserErrors;
  if (errors.length > 0) {
    return { ok: false, mediaIds: [], error: errors.map((e) => e.message).join("; ") };
  }
  return { ok: true, mediaIds: (data.productCreateMedia.media ?? []).map((m) => m.id) };
}

const PRODUCT_REORDER_MEDIA_MUTATION = `
  mutation ProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      mediaUserErrors { field message }
    }
  }
`;

/**
 * Sets the exact order of a product's media — used after upload to apply
 * whatever sequence the user dragged existing and newly-uploaded images
 * into (position 0 becomes the featured image). Best-effort — a failure
 * here shouldn't fail the whole upload, the images are already attached.
 */
export async function reorderProductMedia(productId: string, orderedMediaIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (orderedMediaIds.length === 0) return { ok: true };
  try {
    const data = await shopifyGraphQL<{
      productReorderMedia: { mediaUserErrors: UserError[] };
    }>(PRODUCT_REORDER_MEDIA_MUTATION, {
      id: productId,
      moves: orderedMediaIds.map((id, index) => ({ id, newPosition: String(index) })),
    });
    const errors = data.productReorderMedia.mediaUserErrors;
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reorder the images." };
  }
}

const ORDERED_MEDIA_QUERY = `
  query OrderedProductMedia($id: ID!, $after: String) {
    product(id: $id) {
      media(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          mediaContentType
          status
          ... on MediaImage { image { url } }
        }
      }
    }
  }
`;

export interface OrderedMediaNode {
  id: string;
  kind: string;
  status: string;
  url: string | null;
}

/** Shopify holds at most 250 media per product; this only guards against a runaway loop. */
const MAX_MEDIA_PAGES = 5;

/**
 * Every item in the product's gallery in the order the admin shows it — videos and 3D models included, because
 * they take up a position too. Unlike `getExistingProductMedia` this THROWS on a failed read: replacing "position 3"
 * from a guessed list would overwrite the wrong picture. Returns null when the product doesn't exist.
 */
export async function getOrderedProductMedia(productId: string): Promise<OrderedMediaNode[] | null> {
  const nodes: OrderedMediaNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_MEDIA_PAGES; page++) {
    const data: {
      product: {
        media: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: { id: string; mediaContentType: string; status: string; image?: { url: string } | null }[];
        };
      } | null;
    } = await shopifyGraphQL(ORDERED_MEDIA_QUERY, { id: productId, after });
    if (!data.product) return null;
    for (const node of data.product.media.nodes) {
      nodes.push({ id: node.id, kind: node.mediaContentType, status: node.status, url: node.image?.url ?? null });
    }
    if (!data.product.media.pageInfo.hasNextPage) break;
    after = data.product.media.pageInfo.endCursor;
  }
  return nodes;
}

const FILE_UPDATE_MUTATION = `
  mutation ReplaceImageSource($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id }
      userErrors { field message }
    }
  }
`;

/**
 * Swaps the picture inside an existing image, keeping the same media item — so it keeps its position in the gallery,
 * its alt text, and every variant it is assigned to. (Deleting and re-adding would drop the variant links.)
 * The new bytes must already be uploaded; `resourceUrl` is the staged upload's address.
 */
export async function replaceImageSource(mediaId: string, resourceUrl: string): Promise<{ ok: boolean; error?: string }> {
  const data = await shopifyGraphQL<{ fileUpdate: { files: { id: string }[] | null; userErrors: UserError[] } }>(FILE_UPDATE_MUTATION, {
    files: [{ id: mediaId, originalSource: resourceUrl }],
  });
  const errors = data.fileUpdate.userErrors;
  if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
  return { ok: true };
}
