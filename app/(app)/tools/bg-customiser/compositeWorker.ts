import { readZipImage, type StreamingZipHandle } from "@/lib/skuMediaZip";
import {
  compositeBackground,
  applyZoomAndLogo,
  sampleCornerAverageColor,
  type BackgroundConfig,
  type ForegroundZoom,
  type LogoOverlay,
  type CanvasShape,
  type TextOverlay,
  type AverageColor,
} from "@/lib/backgroundComposite";
import { processImage } from "@/lib/imageProcessing";
import { applyRenamePattern, type WorkerConversion } from "@/lib/conversionSettings";

/**
 * Runs inside a dedicated Web Worker (see `workerPool.ts`, which spawns
 * one of these per CPU core and gives each an equal slice of the batch) —
 * this is what actually turns "N images to process, one at a time" into
 * real parallelism: `compositeBackground`/`applyZoomAndLogo` do the exact
 * same Canvas work as before (see `backgroundComposite.ts`'s own note on
 * why it's `OffscreenCanvas`-based specifically so it runs unchanged in
 * here), just on a separate OS thread from the page and from every other
 * worker, instead of all sharing the one main-thread event loop.
 *
 * Each worker reads its own images directly from the zip — `zip` (a
 * `StreamingZipHandle`: a `File` plus a small `Map` of entry metadata) is
 * structured-cloned into this worker once, and `File`/`Map` both survive
 * that clone as fully working objects, so no image bytes need to be
 * pre-read and shipped over on the main thread first.
 */

/** "convert-only" = no background / zoom / logo edit at all — the original image just goes through format conversion. */
export type WorkerJobMode = "primary" | "secondary" | "zoom-only" | "convert-only";

export interface CompositeWorkerJob {
  path: string;
  mode: WorkerJobMode;
  /** The image's SKU folder and 1-based position within it — what a rename pattern's {folder} / {index} fill in. Only needed when a conversion with a rename pattern is requested. */
  folder?: string;
  position?: number;
}

export interface RunMessage {
  type: "run";
  zip: StreamingZipHandle;
  jobs: CompositeWorkerJob[];
  primaryConfig: BackgroundConfig;
  secondaryConfig: BackgroundConfig;
  foregroundZoom: ForegroundZoom;
  logo?: LogoOverlay;
  canvasShape: CanvasShape;
  textOverlay?: TextOverlay;
  /** When set, every finished image is converted right here in the worker (same `processImage` the Media Format Converter uses) before being sent back. */
  conversion?: WorkerConversion;
}

export type CancelMessage = { type: "cancel" };

export type IncomingMessage = RunMessage | CancelMessage;

export type WorkerResponse =
  | { type: "result"; path: string; blob: Blob; avgColor?: AverageColor; outputFilename?: string }
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

workerSelf.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    return;
  }

  const { zip, jobs, primaryConfig, secondaryConfig, foregroundZoom, logo, canvasShape, textOverlay, conversion } = message;

  for (const job of jobs) {
    if (cancelled) break;
    try {
      const source = await readZipImage(zip, job.path);
      if (!source) throw new Error("Couldn't read this file from the zip.");
      const isBackgroundJob = job.mode === "primary" || job.mode === "secondary";
      const baseName = job.path.split("/").pop() ?? job.path;
      let blob: Blob;
      // What `processImage` is handed: the untouched source for a convert-only job, or the freshly composited PNG (named .png to match its bytes).
      let current = { blob: source.blob, filename: baseName, mimeType: source.mimeType };
      if (job.mode === "convert-only") {
        blob = source.blob;
      } else {
        blob =
          job.mode === "primary"
            ? await compositeBackground(source.blob, primaryConfig, foregroundZoom, logo, canvasShape, textOverlay)
            : job.mode === "secondary"
              ? await compositeBackground(source.blob, secondaryConfig, foregroundZoom, logo, canvasShape, textOverlay)
              : await applyZoomAndLogo(source.blob, foregroundZoom, logo, canvasShape, textOverlay);
        current = { blob, filename: baseName.replace(/\.[a-zA-Z0-9]+$/, ".png"), mimeType: "image/png" };
      }
      // Only sampled for an actual background swap — a zoom-only image's
      // corners are whatever the original photo had, not a color this
      // batch chose, so it's not a meaningful thing to compare against the
      // rest of a background-swap batch's outliers.
      const avgColor = isBackgroundJob ? await sampleCornerAverageColor(blob).catch(() => undefined) : undefined;
      let outputFilename: string | undefined;
      if (conversion) {
        const converted = await processImage(current, conversion.settings);
        blob = converted.blob;
        outputFilename = applyRenamePattern(conversion.renamePattern, converted.filename, job.folder ?? "", job.position ?? 0);
      }
      workerSelf.postMessage({ type: "result", path: job.path, blob, avgColor, outputFilename });
    } catch (err) {
      workerSelf.postMessage({ type: "error", path: job.path, message: err instanceof Error ? err.message : "Couldn't apply the background." });
    }
  }

  workerSelf.postMessage({ type: "done" });
};
