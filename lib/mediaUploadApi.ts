import type { ExistingMediaItem, StagedUploadTarget } from "@/lib/shopify/media";

/** No answer in this long counts as a failed step rather than a worker waiting forever. */
const REQUEST_TIMEOUT_MS = 180_000;

/**
 * Browser-side calls for the Media uploader's per-product steps. They go to a
 * route (not server actions) so several workers can run at the same time —
 * Next.js executes a page's server actions strictly one after another.
 * Same inputs and results as the equivalent server actions; a network or HTTP
 * failure throws, which the caller's upload try/catch reports on the row.
 */
async function call<T>(op: string, args: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/media-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, args }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`The request didn't reach the server (${err instanceof Error ? err.message : "no details"}).`);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) {
    throw new Error((body as { error?: string } | null)?.error ?? `The server answered ${response.status}.`);
  }
  return body;
}

export const mediaApi = {
  getExistingMediaBatch: (productIds: string[]) => call<Record<string, ExistingMediaItem[]>>("existing", { productIds }),
  createStagedUploads: (files: { filename: string; mimeType: string; fileSize: string }[]) =>
    call<{ ok: boolean; targets: StagedUploadTarget[]; error?: string }>("stage", { files }),
  attachProductMedia: (productId: string, files: { resourceUrl: string; alt: string }[]) =>
    call<{ ok: boolean; mediaIds: string[]; error?: string }>("attach", { productId, files }),
  reorderProductMedia: (productId: string, orderedMediaIds: string[]) => call<{ ok: boolean; error?: string }>("reorder", { productId, orderedMediaIds }),
  clearProductMedia: (productId: string) => call<{ ok: boolean; error?: string }>("clear", { productId }),
  deleteProductMediaIds: (productId: string, mediaIds: string[]) => call<{ ok: boolean; error?: string }>("deleteIds", { productId, mediaIds }),
};
