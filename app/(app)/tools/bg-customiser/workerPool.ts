import type { StreamingZipHandle } from "@/lib/skuMediaZip";
import type { BackgroundConfig, ForegroundZoom, LogoOverlay, CanvasShape, TextOverlay, AverageColor } from "@/lib/backgroundComposite";
import type { WorkerConversion } from "@/lib/conversionSettings";
import type { CompositeWorkerJob, RunMessage, WorkerResponse } from "./compositeWorker";

// More workers than CPU cores doesn't process anything faster — real
// parallelism comes from separate OS threads, one per worker, and a
// device only has so many to actually run on at once — so this caps the
// pool regardless of how large the batch or `navigator.hardwareConcurrency`
// is. Also the ceiling on the user-facing worker-count picker in the UI.
export const MAX_WORKERS = 8;

/** This device's own core count, capped at `MAX_WORKERS` — what the worker-count picker defaults to before the user overrides it. */
export function getDefaultWorkerCount(): number {
  const cpuCount = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(cpuCount, MAX_WORKERS));
}

export interface WorkerPoolOptions {
  zip: StreamingZipHandle;
  jobs: CompositeWorkerJob[];
  primaryConfig: BackgroundConfig;
  secondaryConfig: BackgroundConfig;
  foregroundZoom: ForegroundZoom;
  logo?: LogoOverlay;
  /** Defaults to "original" (unchanged behavior) when omitted — see `backgroundComposite.ts`. */
  canvasShape?: CanvasShape;
  textOverlay?: TextOverlay;
  /** How many workers to spawn — clamped to [1, MAX_WORKERS] and to the actual job count. Defaults to `getDefaultWorkerCount()` when omitted. */
  workerCount?: number;
  /** Format conversion applied by the same workers right after each image is produced; omit for "leave as it is". */
  conversion?: WorkerConversion;
  /** `outputFilename` is only set when `conversion` was — it carries the new extension / rename pattern. */
  onResult: (path: string, blob: Blob, avgColor?: AverageColor, outputFilename?: string) => void;
  onError: (path: string, message: string) => void;
}

export interface WorkerPoolHandle {
  /** Resolves once every worker has finished — either it ran out of jobs, or `cancel()` was called and every in-flight image wrapped up. */
  promise: Promise<void>;
  /** Tells every worker to stop picking up new jobs after whatever it's currently on — already-finished results are kept, nothing in-flight is torn out mid-composite. */
  cancel: () => void;
}

/**
 * Splits `jobs` into up to `MAX_WORKERS` equal-sized contiguous slices —
 * job count divided evenly, remainder spread across the first few slices
 * — and runs each slice on its own dedicated Web Worker running
 * `compositeWorker.ts`. Each worker composites its slice independently
 * and in parallel with every other one; this function just fans the work
 * out and fans the results back in, calling `onResult`/`onError` as each
 * image finishes (in whatever order its worker gets to it — not
 * necessarily the original list order).
 */
export function runCompositeWorkerPool(options: WorkerPoolOptions): WorkerPoolHandle {
  const { zip, jobs, primaryConfig, secondaryConfig, foregroundZoom, logo, canvasShape = "original", textOverlay, conversion, onResult, onError } = options;

  if (jobs.length === 0) {
    return { promise: Promise.resolve(), cancel: () => {} };
  }

  const requested = options.workerCount ?? getDefaultWorkerCount();
  const workerCount = Math.max(1, Math.min(requested, MAX_WORKERS, jobs.length));

  const sliceSize = Math.ceil(jobs.length / workerCount);
  const slices: CompositeWorkerJob[][] = [];
  for (let i = 0; i < jobs.length; i += sliceSize) {
    slices.push(jobs.slice(i, i + sliceSize));
  }

  const workers: Worker[] = [];

  const promise = Promise.all(
    slices.map(
      (slice) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL("./compositeWorker.ts", import.meta.url), { type: "module" });
          workers.push(worker);

          worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const message = event.data;
            if (message.type === "result") onResult(message.path, message.blob, message.avgColor, message.outputFilename);
            else if (message.type === "error") onError(message.path, message.message);
            else if (message.type === "done") {
              worker.terminate();
              resolve();
            }
          };
          worker.onerror = (event) => {
            worker.terminate();
            reject(event.error instanceof Error ? event.error : new Error(event.message || "A background worker crashed."));
          };

          const runMessage: RunMessage = { type: "run", zip, jobs: slice, primaryConfig, secondaryConfig, foregroundZoom, logo, canvasShape, textOverlay, conversion };
          worker.postMessage(runMessage);
        }),
    ),
  ).then(() => undefined);

  const cancel = () => {
    for (const worker of workers) worker.postMessage({ type: "cancel" });
  };

  return { promise, cancel };
}
