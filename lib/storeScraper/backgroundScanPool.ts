import "server-only";
import { Worker } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import { MAX_SCAN_WORKERS } from "./scanWorkerConstants";

// Reading each image's bytes is I/O-bound and already runs at high
// concurrency on the main thread (see `scan-backgrounds/route.ts`) — but
// actually decoding a JPEG/PNG and sampling its border pixels is CPU work,
// and Node's own event loop only ever runs ONE thread's worth of JS at a
// time. However many decodes look "in flight" via `Promise.all`, they were
// really just serialized on a single core — for a real job's several
// thousand images, that's minutes of wall-clock time doing work an 8+ core
// machine could otherwise spread across every core at once. This pool is
// what actually gets that parallelism: real OS threads, not just
// interleaved async I/O.
const WORKER_SCRIPT = path.join(process.cwd(), "server-workers", "backgroundScanWorker.js");

export interface BackgroundScanPool {
  /** Decodes `bytes` and returns whether it looks like a plain/uniform background — offloaded to whichever worker in the pool is next in line. */
  run(bytes: Uint8Array): Promise<boolean>;
  terminate(): Promise<void>;
}

/**
 * `workerScript` defaults to the main, single-margin heuristic
 * (`backgroundScanWorker.js`). `verify-flagged/route.ts` passes a different
 * script (`verifyFlaggedScanWorker.js`) — a separate, more lenient
 * two-ring check that recovers dimension-overlay false positives at the
 * cost of an occasional false negative on lifestyle photos, acceptable
 * ONLY there because that pool's results are a human-reviewed suggestion,
 * not an unreviewed classification. See that worker's own doc comment.
 */
export function createBackgroundScanPool(
  size: number = Math.min(MAX_SCAN_WORKERS, Math.max(1, os.cpus().length)),
  workerScript: string = WORKER_SCRIPT,
): BackgroundScanPool {
  const workers = Array.from({ length: size }, () => new Worker(workerScript));
  let nextId = 0;
  let rrIndex = 0;
  // Which jobs each worker still owes an answer for — so a crashed worker can be settled instead of leaving its callers waiting forever.
  const pendingByWorker = workers.map(() => new Map<number, (isPlain: boolean) => void>());
  const alive = workers.map(() => true);

  workers.forEach((worker, index) => {
    worker.on("message", (msg: { id: number; isPlain: boolean }) => {
      const resolve = pendingByWorker[index].get(msg.id);
      if (resolve) {
        pendingByWorker[index].delete(msg.id);
        resolve(msg.isPlain);
      }
    });
    // A crashed worker answers its waiting jobs with "not plain" — the safe answer, since it keeps the image rather than dropping it — and takes no new jobs.
    const settle = () => {
      alive[index] = false;
      for (const resolve of pendingByWorker[index].values()) resolve(false);
      pendingByWorker[index].clear();
    };
    worker.on("error", settle);
    worker.on("exit", settle);
  });

  function run(bytes: Uint8Array): Promise<boolean> {
    const id = nextId++;
    // Round-robin over the workers that are still running.
    for (let attempt = 0; attempt < workers.length; attempt++) {
      const index = rrIndex % workers.length;
      rrIndex++;
      if (!alive[index]) continue;
      return new Promise((resolve) => {
        pendingByWorker[index].set(id, resolve);
        workers[index].postMessage({ id, bytes });
      });
    }
    return Promise.resolve(false);
  }

  async function terminate(): Promise<void> {
    await Promise.all(workers.map((w) => w.terminate()));
  }

  return { run, terminate };
}
