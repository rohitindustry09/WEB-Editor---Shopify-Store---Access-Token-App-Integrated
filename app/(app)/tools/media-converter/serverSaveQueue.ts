const UPLOAD_CONCURRENCY = 6;

export interface ServerSaveJob {
  batchName: string;
  /** The converted file's own path within the batch — any nesting the original zip had, preserved as-is (see `app/api/media-converter/save/route.ts`). */
  relativePath: string;
  blob: Blob;
}

export interface ServerSaveResult {
  ok: boolean;
  skipped: boolean;
  error?: string;
}

/** POSTs one converted image to `uploads/Media-format-converter/...` (see `app/api/media-converter/save`). Standalone so both the fire-and-forget queue below and a bounded-concurrency traversal can share the same upload logic. */
export async function uploadImageToServer(job: ServerSaveJob): Promise<ServerSaveResult> {
  try {
    const formData = new FormData();
    formData.set("batchName", job.batchName);
    formData.set("relativePath", job.relativePath);
    formData.set("file", job.blob, job.relativePath.split("/").pop() ?? job.relativePath);

    const res = await fetch("/api/media-converter/save", { method: "POST", body: formData });
    const data = (await res.json()) as { ok: boolean; skipped?: boolean; error?: string };
    return { ok: res.ok && data.ok, skipped: Boolean(data.skipped), error: data.error };
  } catch (err) {
    return { ok: false, skipped: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}

/**
 * A small bounded-concurrency upload queue for saving converted images to
 * `uploads/Media-format-converter/...` as they're produced, rather than
 * all thousands at once — `fetch`ing that many requests simultaneously
 * would overwhelm both the browser's own connection limit and the dev
 * server. Jobs can be pushed in while earlier ones are still uploading;
 * `onSettled` fires after every single job (success or failure) so a
 * caller can track "X of Y saved" live.
 */
export class ServerSaveQueue {
  private pending: ServerSaveJob[] = [];
  private active = 0;
  private onSettled: (result: ServerSaveResult) => void;

  constructor(onSettled: (result: ServerSaveResult) => void) {
    this.onSettled = onSettled;
  }

  push(job: ServerSaveJob): void {
    this.pending.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.active < UPLOAD_CONCURRENCY && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      this.active += 1;
      void uploadImageToServer(job)
        .then((result) => this.onSettled(result))
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  /**
   * Resolves once every already-pushed job (including ones still queued
   * behind the concurrency limit) has settled — or as soon as
   * `shouldStop` returns true, whichever comes first. Cancelling this way
   * doesn't abort whatever's already mid-upload (those still finish and
   * still get saved — never wasted work), it just stops the CALLER from
   * waiting any longer, so a Cancel click takes effect within one poll
   * tick instead of only after the entire remaining queue drains on its
   * own, which for a large batch could be a long, unresponsive-looking
   * wait.
   */
  async drain(shouldStop?: () => boolean): Promise<void> {
    while (this.pending.length > 0 || this.active > 0) {
      if (shouldStop?.()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
