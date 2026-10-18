/**
 * A stable identity for "this same batch", used to match freshly re-added
 * input against progress saved from an earlier run — see
 * `progressStore.ts`. Built from the source name + size (the zip file's
 * own name/size, or a stand-in for a bare-images drop) plus every image
 * path in the batch — not file bytes, which would be far too slow to hash
 * for thousands of images. A heuristic, not a cryptographic guarantee:
 * meant to catch "the same export re-added", not survive a deliberately
 * crafted collision.
 */
export async function computeBatchSignature(sourceName: string, sourceSize: number, imagePaths: string[]): Promise<string> {
  const canonical = [sourceName, String(sourceSize), ...[...imagePaths].sort()].join("|");
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
