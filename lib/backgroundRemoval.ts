import { removeBackground } from "@imgly/background-removal";

/** Which part of the run a percentage belongs to — the one-time model download, or this image's own processing. */
export type BgRemovalPhase = "download" | "compute";

export interface BgRemovalProgress {
  phase: BgRemovalPhase;
  /** 0-100 within the current phase. */
  percent: number;
}

/**
 * Removes the background from one image entirely in the browser (WASM/ONNX —
 * the isnet segmentation model), returning a transparent PNG. The model
 * itself is fetched from imgly's CDN on first use and cached by the browser
 * afterward; the image being processed never leaves the browser.
 *
 * The library reports raw progress as `fetch:<file>` (model download, one
 * event per chunk per file) and `compute:<step>` (decode → inference → mask
 * → encode, as step/4). Those are folded here into a single phase +
 * percentage: download percent is aggregated across every model file so it
 * reads as one download rather than several restarting bars.
 *
 * `device: "gpu"` + `proxyToWorker: true`: confirmed by reading the library's
 * source directly that on its default config (`device: "cpu"`), the actual
 * neural-net inference pass runs synchronously on the calling (main) thread —
 * traced with real timing and found a single run can block it for 20-30+
 * seconds with zero opportunity for anything else (a progress repaint
 * included) to run in between. `proxyToWorker` only ever takes effect when
 * WebGPU is both requested *and* available (`useWebGPU = device==="gpu" &&
 * await webgpu()`), which is what actually offloads the work to a Web Worker
 * and frees the main thread. This is a safe, additive change either way: the
 * library's own `webgpu()` check resolves to `false` (never throws) on any
 * browser without WebGPU, so unsupported browsers fall through to the exact
 * same CPU/main-thread path as before — no regression, just no improvement
 * there.
 */
export async function removeImageBackground(
  image: File | Blob,
  onProgress?: (progress: BgRemovalProgress) => void,
): Promise<Blob> {
  const fetched = new Map<string, { current: number; total: number }>();

  return removeBackground(image, {
    output: { format: "image/png", quality: 1 },
    device: "gpu",
    proxyToWorker: true,
    progress: onProgress
      ? (key: string, current: number, total: number) => {
          if (key.startsWith("fetch:")) {
            fetched.set(key, { current, total });
            let done = 0;
            let size = 0;
            for (const entry of fetched.values()) {
              done += entry.current;
              size += entry.total;
            }
            onProgress({ phase: "download", percent: size > 0 ? Math.min(100, (done / size) * 100) : 0 });
            return;
          }
          onProgress({ phase: "compute", percent: total > 0 ? Math.min(100, (current / total) * 100) : 0 });
        }
      : undefined,
  });
}
