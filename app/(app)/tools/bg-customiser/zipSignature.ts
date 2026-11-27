import type { SkuMediaFolder } from "@/lib/skuMediaZip";

/**
 * A stable identity for "this same zip", used to match a freshly re-added
 * zip against progress saved from an earlier run — see `progressStore.ts`.
 * Built from the file's own name + size plus every folder's SKU and image
 * count (not the zip's raw bytes — hashing tens of thousands of images
 * would be far too slow to run on every zip add). This is a heuristic, not
 * a cryptographic guarantee: it's meant to catch "the same export
 * re-added, on the same or a different day", not to survive a
 * deliberately crafted collision.
 */
export async function computeZipSignature(file: { name: string; size: number }, folders: SkuMediaFolder[]): Promise<string> {
  const canonical = [
    file.name,
    String(file.size),
    ...folders.map((f) => `${f.sku}:${f.imageCount}`).sort(),
  ].join("|");

  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
