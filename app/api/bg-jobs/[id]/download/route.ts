import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { guardOpen } from "@/lib/auth/openGuard";
import { bgJobDownload } from "@/lib/bgJobs";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ZipStreamWriter, waitForDrain } from "@/lib/storeScraper/zipStream";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const READ_CONCURRENCY = 8;

async function listFiles(root: string): Promise<{ folder: string; filename: string; fullPath: string }[]> {
  const files: { folder: string; filename: string; fullPath: string }[] = [];
  let folders: string[];
  try {
    folders = await readdir(root);
  } catch {
    return files;
  }
  for (const folder of folders) {
    const folderPath = path.join(root, folder);
    if (!(await stat(folderPath).catch(() => null))?.isDirectory()) continue;
    for (const filename of await readdir(folderPath).catch(() => [] as string[])) {
      if (filename.endsWith(".tmp")) continue; // a write that was still in progress
      files.push({ folder, filename, fullPath: path.join(folderPath, filename) });
    }
  }
  return files;
}

/** Streams a zip of everything the run has produced so far, straight from the server's disk (never held in memory). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;

  const job = await bgJobDownload((await params).id, visitor);
  if (!job) return new Response("No such run.", { status: 404 });
  const files = await listFiles(job.dir);
  if (files.length === 0) return new Response("Nothing has been produced yet.", { status: 404 });

  const safeName = job.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "download";
  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writer = new ZipStreamWriter();
      try {
        await mapWithConcurrency(files, READ_CONCURRENCY, async (file) => {
          if (stopped) return;
          const bytes = await readFile(file.fullPath);
          if (stopped) return;
          controller.enqueue(writer.addEntry(`${file.folder}/${file.filename}`, new Uint8Array(bytes)));
          // A slow connection must not let the whole export pile up in memory.
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
      "Content-Disposition": `attachment; filename="${safeName}.background-customised.zip"`,
    },
  });
}
