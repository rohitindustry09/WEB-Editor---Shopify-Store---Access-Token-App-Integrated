import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import path from "node:path";
import { access } from "node:fs/promises";
import { getJob } from "@/lib/storeScraper/store";
import { UPLOADS_ROOT, skuFolderFor, filenameFromUrl } from "@/lib/storeScraper/mediaUpload";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { ScrapedProduct } from "@/lib/storeScraper/types";

const CHECK_CONCURRENCY = 24;

export interface DuplicateSkuGroup {
  sku: string;
  products: { productId: string; name: string }[];
}

export interface MissingMediaImage {
  productName: string;
  position: number;
  url: string;
}

export interface MissingMediaSku {
  sku: string;
  productNames: string[];
  totalImages: number;
  missing: MissingMediaImage[];
}

export interface MediaReport {
  hostname: string;
  totalProducts: number;
  totalSkuFolders: number;
  duplicateSkuGroups: DuplicateSkuGroup[];
  totalImages: number;
  missingCount: number;
  missingSkus: MissingMediaSku[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ground-truth media report for a job — checks the actual `uploads/`
 * folder on disk (not the background scan's own cache, which is a
 * completely separate, secondary process only concerned with plain-vs-not
 * background classification) for every image every scraped product
 * references. Two distinct things this surfaces, both invisible anywhere
 * else in the UI:
 *
 * - Duplicate SKUs — more than one scraped product mapping to the same
 *   `skuFolderFor()` folder, which is also why a SKU-folder count can be
 *   lower than the product count (see `scan-backgrounds/route.ts`'s own
 *   `computeSkuFolderProgress`).
 * - Missing media — any image whose file genuinely isn't on disk yet,
 *   whether "Save Media to Server" was never run, partially failed, or a
 *   file was deleted after the fact. Checked fresh on every call rather
 *   than trusting any previous save's own transient result, which is lost
 *   the moment that request's response is gone.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(_request);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  let hostname = "store";
  try {
    hostname = new URL(job.options.inputUrl).hostname;
  } catch {
    // keep the fallback
  }

  const bySkuFolder = new Map<string, ScrapedProduct[]>();
  for (const product of job.products) {
    const folder = skuFolderFor(product);
    const list = bySkuFolder.get(folder) ?? [];
    list.push(product);
    bySkuFolder.set(folder, list);
  }

  const duplicateSkuGroups: DuplicateSkuGroup[] = [];
  for (const [sku, products] of bySkuFolder) {
    if (products.length > 1) {
      duplicateSkuGroups.push({ sku, products: products.map((p) => ({ productId: p.productId, name: p.name })) });
    }
  }

  const workItems = job.products.flatMap((product) =>
    product.images.map((url, index) => ({ product, url, index })),
  );

  const missingByFolder = new Map<string, MissingMediaImage[]>();
  await mapWithConcurrency(workItems, CHECK_CONCURRENCY, async ({ product, url, index }) => {
    const skuFolder = skuFolderFor(product);
    const filename = filenameFromUrl(url, index + 1);
    const filePath = path.join(UPLOADS_ROOT, hostname, skuFolder, filename);
    if (await fileExists(filePath)) return;
    const list = missingByFolder.get(skuFolder) ?? [];
    list.push({ productName: product.name, position: index, url });
    missingByFolder.set(skuFolder, list);
  });

  const missingSkus: MissingMediaSku[] = Array.from(missingByFolder.entries()).map(([sku, missing]) => ({
    sku,
    productNames: Array.from(new Set((bySkuFolder.get(sku) ?? []).map((p) => p.name))),
    totalImages: (bySkuFolder.get(sku) ?? []).reduce((sum, p) => sum + p.images.length, 0),
    missing,
  }));
  missingSkus.sort((a, b) => b.missing.length - a.missing.length);

  const report: MediaReport = {
    hostname,
    totalProducts: job.products.length,
    totalSkuFolders: bySkuFolder.size,
    duplicateSkuGroups,
    totalImages: workItems.length,
    missingCount: missingSkus.reduce((sum, s) => sum + s.missing.length, 0),
    missingSkus,
  };
  return NextResponse.json(report);
}
