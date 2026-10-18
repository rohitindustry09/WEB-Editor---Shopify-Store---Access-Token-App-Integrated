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
