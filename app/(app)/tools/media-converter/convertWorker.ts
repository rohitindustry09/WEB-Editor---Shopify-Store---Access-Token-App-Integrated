import { readZipImage, guessImageMimeType, type StreamingZipHandle, type ZipImageFile } from "@/lib/skuMediaZip";
import { processImage, type ConversionSettings } from "@/lib/imageProcessing";

/**
 * Runs inside a dedicated Web Worker (see `workerPool.ts`, which spawns
 * one of these per CPU core and gives each an equal slice of the batch) —
 * this is what turns "N images to convert, one at a time" into real
 * parallelism: `processImage` does the exact same Canvas work as before
 * (see `imageProcessing.ts`'s own note on why it's `OffscreenCanvas`-based
 * specifically so it runs unchanged in here), just on a separate OS
 * thread from the page and from every other worker.
 *
 * Each worker reads its own source images directly — either from a zip
 * (`StreamingZipHandle`: a `File` plus a small `Map` of entry metadata,
 * structured-cloned into this worker once) or from a `Map` of bare
 * `File`s (the "drop loose images" path) — both survive a structured
 * clone as fully working objects, so no image bytes need to be pre-read
 * and shipped over on the main thread first.
 */

export interface ConvertWorkerJob {
  path: string;
}

export interface RunMessage {
  type: "run";
  zip: StreamingZipHandle | null;
  directFiles: Map<string, File> | null;
  jobs: ConvertWorkerJob[];
  settings: ConversionSettings;
}

export type CancelMessage = { type: "cancel" };

export type IncomingMessage = RunMessage | CancelMessage;

export type WorkerResponse =
  | { type: "result"; path: string; blob: Blob; filename: string; mimeType: string; originalSize: number; width: number; height: number }
  | { type: "error"; path: string; message: string }
  | { type: "done" };

// Typed as a minimal structural shape rather than `DedicatedWorkerGlobalScope`
// — this project's tsconfig only pulls in the "dom" lib (shared with every
// other file), not "webworker", and the two declare conflicting globals if
// both are active at once. `self` at runtime, inside a worker script, is
// genuinely the worker's global scope regardless of how TypeScript sees it.
const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<IncomingMessage>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

let cancelled = false;

async function readSourceImage(
  zip: StreamingZipHandle | null,
  directFiles: Map<string, File> | null,
  path: string,
): Promise<ZipImageFile | null> {
  if (zip) return readZipImage(zip, path);
  const direct = directFiles?.get(path);
  if (!direct) return null;
  return { path, filename: path, blob: direct, mimeType: direct.type || guessImageMimeType(path) };
}

workerSelf.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }

  const { zip, directFiles, jobs, settings } = message;

  for (const job of jobs) {
    if (cancelled) break;
    try {
      const source = await readSourceImage(zip, directFiles, job.path);
      if (!source) throw new Error("Couldn't find this file anymore.");
      const processed = await processImage(source, settings);
      workerSelf.postMessage({
        type: "result",
        path: job.path,
        blob: processed.blob,
        filename: processed.filename,
        mimeType: processed.mimeType,
        originalSize: processed.originalSize,
        width: processed.width,
        height: processed.height,
      });
    } catch (err) {
      workerSelf.postMessage({ type: "error", path: job.path, message: err instanceof Error ? err.message : "Couldn't convert this image." });
    }
  }

  workerSelf.postMessage({ type: "done" });
};
