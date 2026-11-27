import { readZipImage, type StreamingZipHandle } from "@/lib/skuMediaZip";
import {
  type BackgroundConfig,
  type ForegroundZoom,
  type LogoOverlay,
  type CanvasShape,
  type TextOverlay,
  type AverageColor,
} from "@/lib/backgroundComposite";
import { renderItem } from "@/lib/bgItem";
import type { WorkerConversion } from "@/lib/conversionSettings";

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
      // The same function the server job runs, so a browser run and a server run can't produce different pictures.
      const { blob, avgColor, outputFilename } = await renderItem(
        { path: job.path, mode: job.mode, folder: job.folder, position: job.position, source },
        { primaryConfig, secondaryConfig, foregroundZoom, logo, canvasShape, textOverlay, conversion },
      );
      workerSelf.postMessage({ type: "result", path: job.path, blob, avgColor, outputFilename });
    } catch (err) {
      workerSelf.postMessage({ type: "error", path: job.path, message: err instanceof Error ? err.message : "Couldn't apply the background." });
    }
  }

  workerSelf.postMessage({ type: "done" });
};
