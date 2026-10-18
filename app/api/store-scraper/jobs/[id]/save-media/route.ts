import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/storeScraper/store";
import { saveMediaToUploads } from "@/lib/storeScraper/mediaUpload";
import { clearScanCacheEntries } from "@/lib/storeScraper/backgroundScanCache";

/** Saves every scraped product's images straight to local disk (`uploads/<site>/<SKU>/<original-filename>`) — see `mediaUpload.ts`. Returns once every image has been either saved or attempted; the client polls `export-media-progress` for live progress in the meantime. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    const result = await saveMediaToUploads(job.id, hostname, job.products, job.options.allowInsecureTls);
    // Only the specific files this run actually (re)wrote need their scan
    // result invalidated — everything skip-if-exists left untouched is
    // still exactly what it was scanned as. Wiping the WHOLE job's cache
    // here used to throw out potentially tens of thousands of correct,
    // already-checked results just because a handful of previously-failed
    // files finally got saved.
    clearScanCacheEntries(job.id, result.savedKeys);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save media." }, { status: 500 });
  }
}
