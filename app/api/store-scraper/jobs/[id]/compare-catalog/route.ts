import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/storeScraper/store";
import { resolveProductIdentifiers } from "@/lib/shopify/products";
import { mapWithConcurrency } from "@/lib/concurrency";

// `resolveProductIdentifiers` builds one GraphQL query with an `OR` clause
// per SKU and caps results at 250 — fine for its usual small-batch callers,
// but a "scrape the entire store" job here can easily have several thousand
// unique SKUs. Chunking keeps each query's OR-clause a reasonable size and
// keeps the result cap from silently truncating a large comparison.
const CHUNK_SIZE = 100;
const CHUNK_CONCURRENCY = 4;

/**
 * Flags which of a scraped job's SKUs already exist somewhere in the
 * CONNECTED Shopify store — this tool scrapes an arbitrary (usually
 * someone else's) store of any platform, but "your own store" for
 * comparison purposes is always Shopify, the one this whole app is
 * connected to. Reuses `resolveProductIdentifiers`, the same batched
 * SKU-lookup the product-identifier resolver elsewhere in the app already
 * uses, rather than one GraphQL query per SKU.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(_request);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const skus = Array.from(new Set(job.products.map((p) => p.sku).filter((sku): sku is string => Boolean(sku?.trim()))));
  if (skus.length === 0) {
    return NextResponse.json({ existingSkus: [], noSkuCount: job.products.length, checkedCount: 0 });
  }

  const chunks: string[][] = [];
  for (let i = 0; i < skus.length; i += CHUNK_SIZE) chunks.push(skus.slice(i, i + CHUNK_SIZE));

  const existingSkus: string[] = [];
  await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, async (chunk) => {
    const resolved = await resolveProductIdentifiers(chunk);
    for (const r of resolved) if (r.product !== null) existingSkus.push(r.raw);
  });
  const noSkuCount = job.products.length - job.products.filter((p) => p.sku?.trim()).length;

  return NextResponse.json({ existingSkus, noSkuCount, checkedCount: skus.length });
}
