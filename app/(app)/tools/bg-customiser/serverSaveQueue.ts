const UPLOAD_CONCURRENCY = 6;

export interface ServerSaveJob {
  website: string;
  sku: string;
  filename: string;
  blob: Blob;
}

export interface ServerSaveResult {
  ok: boolean;
  skipped: boolean;
  error?: string;
}

/** POSTs one image to `uploads/background-customiser/...` (see `app/api/bg-customiser/save`). Standalone so both the fire-and-forget queue below and a bounded-concurrency traversal (see `saveAllFilesToServer` in `BgCustomiserForm.tsx`) can share the same upload logic. */
export async function uploadImageToServer(job: ServerSaveJob): Promise<ServerSaveResult> {
  try {
    const formData = new FormData();
    formData.set("website", job.website);
    formData.set("sku", job.sku);
    formData.set("filename", job.filename);
    formData.set("file", job.blob, job.filename);

    const res = await fetch("/api/bg-customiser/save", { method: "POST", body: formData });
    const data = (await res.json()) as { ok: boolean; skipped?: boolean; error?: string };
    return { ok: res.ok && data.ok, skipped: Boolean(data.skipped), error: data.error };
  } catch (err) {
    return { ok: false, skipped: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}

/**
 * A small bounded-concurrency upload queue for saving processed images to
 * `uploads/background-customiser/...` as they're produced, rather than
 * all 16000+ at once — `fetch`ing that many requests simultaneously would
 * overwhelm both the browser's own connection limit and the dev server.
 * Jobs can be pushed in while earlier ones are still uploading;
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
   * waiting any longer.
   */
  async drain(shouldStop?: () => boolean): Promise<void> {
    while (this.pending.length > 0 || this.active > 0) {
      if (shouldStop?.()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
