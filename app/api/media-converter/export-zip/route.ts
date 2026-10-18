import { guardApi } from "@/lib/auth/apiGuard";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ZipStreamWriter, waitForDrain } from "@/lib/storeScraper/zipStream";

/**
 * Streams a ZIP of everything saved under
 * `uploads/Media-format-converter/<batchName>/` straight from disk — this
 * is the actual "Convert and download zip" output now, replacing a
 * client-side, whole-archive-in-memory `Blob` build. A real batch here can
 * run into tens of GB (thousands of images, no size cap necessarily set),
 * which reliably crashes the browser tab outright ("Out of Memory") if
 * held in memory all at once — the same failure mode fixed for the
 * background customiser, see `bg-customiser/export-zip/route.ts`. The
 * server has no such per-tab memory ceiling, and reading + zipping one
 * file at a time (bounded concurrency, streamed straight into the HTTP
 * response) never holds more than a handful of files in memory at once,
 * regardless of how large the whole export is.
 */
const UPLOADS_ROOT = path.join(process.cwd(), "uploads", "Media-format-converter");

const READ_CONCURRENCY = 8;

interface BatchFile {
  /** Path relative to the batch's own root — preserves whatever nested folder structure the original zip had. */
  relativePath: string;
  fullPath: string;
}

/** Recursively walks `dir`, unlike the background customiser's fixed 2-level SKU/filename layout — media converter preserves arbitrary original folder nesting. */
async function listBatchFiles(dir: string, relativePrefix = ""): Promise<BatchFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const files: BatchFile[] = [];
  for (const name of entries) {
    const fullPath = path.join(dir, name);
    const relativePath = relativePrefix ? `${relativePrefix}/${name}` : name;
    const info = await stat(fullPath).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) {
      files.push(...(await listBatchFiles(fullPath, relativePath)));
    } else if (!name.endsWith(".tmp")) {
      files.push({ relativePath, fullPath });
    }
  }
  return files;
}

export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const batchName = searchParams.get("batch")?.trim();
  if (!batchName) return new Response("Missing ?batch=.", { status: 400 });

  const batchDir = path.join(UPLOADS_ROOT, batchName);
  const files = await listBatchFiles(batchDir);
  if (files.length === 0) {
    return new Response("Nothing saved for this batch yet — convert something first.", { status: 404 });
  }

  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer = new ZipStreamWriter();
      try {
        await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
          if (stopped) return;
          const bytes = await readFile(file.fullPath);
          if (stopped) return;
          controller.enqueue(writer.addEntry(file.relativePath, new Uint8Array(bytes)));
          // Reading from disk is far faster than most clients can actually
          // download — without this, a slow connection lets the whole
          // export pile up in memory as fast as disk I/O allows, which is
          // what crashes the Node process itself (not just a browser tab)
          // on a real multi-GB batch. See `waitForDrain`'s own note.
          await waitForDrain(controller, () => stopped);
        });
        if (stopped) return;
        controller.enqueue(writer.finish());
        controller.close();
      } catch (err) {
        if (!stopped) controller.error(err);
      }
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${batchName}-converted.zip"`,
    },
  });
}
