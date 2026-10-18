import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/storeScraper/store";
import { streamExcludedZip } from "@/lib/storeScraper/zipExport";

/**
 * `?exclude=0,2` — comma-separated, 0-based image indexes to leave out of
 * the zip (index 0 = a product's first image). `?excludeNonPlain=1` also
 * leaves out any image whose background isn't a plain/uniform studio
 * backdrop (a lifestyle photo, a gradient, anything `isPlainBackgroundImage`
 * doesn't recognize) — checked fresh per image at export time, not from a
 * cached scan. `?keep=<uri-encoded sku>::<position>,...` overrides that:
 * an image the user has manually marked "actually fine" on the
 * flagged-preview page is kept even if the heuristic still disagrees. The
 * zip's own filename encodes the position selection:
 * `<hostname>.excluded.0.and.2.zip`, or plain `<hostname>.zip` when nothing
 * is excluded by position (the non-plain-background exclusion and its
 * overrides don't affect the filename — they can vary run to run).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const excludeIndexes = new Set(
    (searchParams.get("exclude") ?? "")
      .split(",")
      .map((raw) => raw.trim())
      // An empty `exclude=` query string splits to `[""]`, not `[]` — and
      // `Number("")` coerces to `0`, not `NaN`, so without this filter a
      // "nothing excluded" export silently excluded image position 0 from
      // every product's zip entry (and named the file `excluded.0.zip`) as
      // if the user had checked it.
      .filter((raw) => raw.length > 0)
      .map((raw) => Number(raw))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
  const excludeNonPlain = searchParams.get("excludeNonPlain") === "1";
  const keepOverrides = new Set(
    (searchParams.get("keep") ?? "")
      .split(",")
      .map((raw) => raw.trim())
      .filter((raw) => raw.length > 0)
      .map((raw) => decodeURIComponent(raw)),
  );

  let hostname = "store";
  try {
    hostname = new URL(job.options.inputUrl).hostname;
  } catch {
    // keep the fallback
  }

  const sortedIndexes = [...excludeIndexes].sort((a, b) => a - b);
  const filename = sortedIndexes.length > 0 ? `${hostname}.excluded.${sortedIndexes.join(".and.")}.zip` : `${hostname}.zip`;

  const stream = streamExcludedZip(
    job.id,
    hostname,
    job.products,
    excludeIndexes,
    job.options.allowInsecureTls,
    excludeNonPlain,
    keepOverrides,
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
