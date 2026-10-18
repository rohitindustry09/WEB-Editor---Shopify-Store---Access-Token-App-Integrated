import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

/**
 * On-disk cache of downloaded image BYTES, keyed by their source URL — not
 * a cache of the finished zip, since different exports of the same job can
 * ask for different image positions excluded. Caching at the image level
 * means every one of those variants (exclude position 1, exclude nothing,
 * exclude 1+3, a re-download after a refresh, ...) reuses the same
 * underlying downloads instead of re-fetching the exact same bytes from
 * the store's CDN again — the first export of a large store still pays
 * the full download cost, but every export after that is disk-speed
 * instead of network-speed for anything already cached.
 *
 * Lives in `data/`, the same directory (and write-then-rename safety
 * pattern) `lib/auth/accounts.ts` and `jobPersistence.ts` already use — so
 * it survives a `next build`/dev-server restart the same way job history
 * does, not just a page refresh.
 *
 * Deliberately no eviction/expiry: this is a personal, local tool, not a
 * shared production cache serving many users — unbounded growth is an
 * acceptable trade for simplicity here, same as job history's own disk
 * store. If disk usage ever becomes a real problem, the fix is deleting
 * `data/store-scraper-image-cache/`, which is always safe (worst case,
 * the next export just re-downloads).
 */
const CACHE_DIR = path.join(process.cwd(), "data", "store-scraper-image-cache");

function cacheKeyFor(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

function cacheFilePath(url: string): string {
  return path.join(CACHE_DIR, `${cacheKeyFor(url)}.bin`);
}

export async function getCachedImage(url: string): Promise<Buffer | null> {
  try {
    return await readFile(cacheFilePath(url));
  } catch {
    return null;
  }
}

/** Best-effort — a failed cache write shouldn't fail the download that produced the bytes; it just means this one won't be cached for next time. */
export async function setCachedImage(url: string, bytes: Uint8Array): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const finalPath = cacheFilePath(url);
    const tempPath = `${finalPath}.tmp`;
    await writeFile(tempPath, bytes);
    await rename(tempPath, finalPath);
  } catch {
    // best-effort, see doc comment
  }
}
