import { guardApi } from "@/lib/auth/apiGuard";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ZipStreamWriter, waitForDrain } from "@/lib/storeScraper/zipStream";

/**
 * Streams a ZIP of everything saved under
 * `uploads/background-customiser/<site>/` straight from disk — this is
 * the actual "Apply & download" output now, replacing a client-side,
 * whole-archive-in-memory `Blob` build that reliably crashed the browser
 * tab ("Out of Memory") on a real batch of 16000+ images. The server has
 * no such per-tab memory ceiling, and reading + zipping one file at a
 * time (bounded concurrency, streamed straight into the HTTP response)
 * never holds more than a handful of files in memory at once, regardless
 * of how large the whole export is.
 */
const UPLOADS_ROOT = path.join(process.cwd(), "uploads", "background-customiser");

const READ_CONCURRENCY = 8;

// Same character set the save route strips from a folder name — export has to
// resolve to exactly the folder that route wrote into.
const UNSAFE_PATH_CHARS = /[\\/:*?"<>|]/g;

function sanitizeSegment(value: string): string {
  return value.replace(UNSAFE_PATH_CHARS, "-").trim();
}

interface SkuFile {
  sku: string;
  filename: string;
  fullPath: string;
}

async function listSkuFiles(siteDir: string): Promise<SkuFile[]> {
  const files: SkuFile[] = [];
  let skuDirs: string[];
  try {
    skuDirs = await readdir(siteDir);
  } catch {
    return files;
  }

  for (const sku of skuDirs) {
    const skuPath = path.join(siteDir, sku);
    const info = await stat(skuPath).catch(() => null);
    if (!info?.isDirectory()) continue;

    const filenames = await readdir(skuPath).catch(() => []);
    for (const filename of filenames) {
      if (filename.endsWith(".tmp")) continue; // an in-progress write from mediaUpload.ts's atomic write-then-rename
      files.push({ sku, filename, fullPath: path.join(skuPath, filename) });
    }
  }
  return files;
}

export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const site = searchParams.get("site")?.trim();
  if (!site) return new Response("Missing ?site=.", { status: 400 });

  const siteDir = path.resolve(UPLOADS_ROOT, sanitizeSegment(site));
  // `..` survives the character strip, so an explicit containment check is what actually keeps this inside uploads/background-customiser/.
  if (!siteDir.startsWith(UPLOADS_ROOT + path.sep)) return new Response("Invalid ?site=.", { status: 400 });

  // Converted output lives in its own per-settings folder (see BgCustomiserForm); `name` lets the download keep the clean site name instead.
  const downloadName = sanitizeSegment(searchParams.get("name") ?? "") || sanitizeSegment(site);
  const files = await listSkuFiles(siteDir);
  if (files.length === 0) {
    return new Response("Nothing saved for this site yet — process a batch first.", { status: 404 });
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
          controller.enqueue(writer.addEntry(`${file.sku}/${file.filename}`, new Uint8Array(bytes)));
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
      "Content-Disposition": `attachment; filename="${downloadName}.background-customised.zip"`,
    },
  });
}
