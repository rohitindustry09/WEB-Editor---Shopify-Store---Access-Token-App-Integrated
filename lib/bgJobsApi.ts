import type { BgJobSnapshot, BgJobSpec, BgZipRef } from "./bgJobTypes";
import type { RemoteZipSource } from "./skuMediaZip";

/** Browser-side calls to the server's Background customiser runs, zip uploads and saved workspace. A failure throws an Error carrying the server's own message. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) throw new Error(body?.error ?? `The server answered ${response.status}.`);
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const bgJobs = {
  list: async (): Promise<BgJobSnapshot[]> => (await call<{ jobs: BgJobSnapshot[] }>("/api/bg-jobs")).jobs,
  cancel: async (id: string): Promise<BgJobSnapshot> => (await call<{ job: BgJobSnapshot }>(`/api/bg-jobs/${encodeURIComponent(id)}`, json("PATCH", { action: "cancel" }))).job,
  /** Packs the download zip again after it failed (for example once disk space has been freed). */
  prepare: async (id: string): Promise<BgJobSnapshot> => (await call<{ job: BgJobSnapshot }>(`/api/bg-jobs/${encodeURIComponent(id)}`, json("PATCH", { action: "prepare" }))).job,
  remove: async (id: string): Promise<void> => {
    await call<{ ok: boolean }>(`/api/bg-jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  downloadUrl: (id: string): string => `/api/bg-jobs/${encodeURIComponent(id)}/download`,
  /** Starts a run on the server. `assets` are the pictures the run needs (background image, logo), keyed by the names the spec uses. */
  create: async (spec: BgJobSpec, assets: Map<string, Blob>): Promise<BgJobSnapshot> => {
    const form = new FormData();
    form.set("spec", JSON.stringify(spec));
    for (const [name, blob] of assets) form.set(name, blob, name);
    return (await call<{ job: BgJobSnapshot }>("/api/bg-jobs", { method: "POST", body: form })).job;
  },
};

/** Pieces sent at the same time. Several in flight keep the connection full even when each request has a long round trip. */
const UPLOAD_CONNECTIONS = 4;
const PIECE_ATTEMPTS = 3;
const SPEED_WINDOW_MS = 4000;

export interface UploadProgress {
  /** Bytes the server has, including ones it already had from an earlier try. */
  sent: number;
  total: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  /** Bytes the server already had, which did not need sending again. */
  alreadyThere: number;
}

/** One piece over XMLHttpRequest, because `fetch` can't report how much of an upload has gone out so far. */
function putPiece(url: string, body: Blob, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      let message = `The server answered ${request.status}.`;
      try {
        message = (JSON.parse(request.responseText) as { error?: string }).error ?? message;
      } catch {
        // Keep the generic message.
      }
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error("The connection dropped."));
    request.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}

/** A name for "this exact file on this computer", so the server recognises one it already has. */
const fingerprintOf = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;

/**
 * Sends a zip from this computer to the server so no run depends on this browser staying open. It goes up in pieces, several at
 * once; pieces the server already has (from an earlier try, or because this same file was uploaded before) are skipped, so a
 * dropped connection resumes and a repeat costs nothing. `onProgress` reports bytes, speed and time left.
 */
export async function uploadZipToServer(file: File, onProgress: (progress: UploadProgress) => void, signal: AbortSignal): Promise<BgZipRef> {
  const begun = await call<{ upload: { id: string; chunkSize: number; have: number[]; complete: boolean } }>("/api/bg-uploads", {
    ...json("POST", { name: file.name, size: file.size, fingerprint: fingerprintOf(file) }),
    signal,
  });
  const { id, chunkSize, have, complete } = begun.upload;
  const pieceSize = (index: number) => Math.min(chunkSize, file.size - index * chunkSize);
  const alreadyThere = have.reduce((sum, index) => sum + pieceSize(index), 0);
  const ref: BgZipRef = { kind: "upload", id };
  if (complete) {
    onProgress({ sent: file.size, total: file.size, bytesPerSecond: 0, etaSeconds: 0, alreadyThere: file.size });
    return ref;
  }

  const haveSet = new Set(have);
  const todo: number[] = [];
  for (let index = 0; index * chunkSize < file.size; index++) if (!haveSet.has(index)) todo.push(index);

  const inFlight = new Map<number, number>();
  let finished = alreadyThere;
  const samples: { at: number; bytes: number }[] = [{ at: Date.now(), bytes: 0 }];
  const report = () => {
    const sent = finished + [...inFlight.values()].reduce((sum, n) => sum + n, 0);
    const now = Date.now();
    samples.push({ at: now, bytes: sent - alreadyThere });
    while (samples.length > 2 && now - samples[0].at > SPEED_WINDOW_MS) samples.shift();
    const first = samples[0];
    const last = samples[samples.length - 1];
    const bytesPerSecond = last.at > first.at ? Math.max(0, ((last.bytes - first.bytes) / (last.at - first.at)) * 1000) : 0;
    onProgress({ sent, total: file.size, bytesPerSecond, etaSeconds: bytesPerSecond > 1024 ? (file.size - sent) / bytesPerSecond : null, alreadyThere });
  };
  report();

  const inner = new AbortController();
  signal.addEventListener("abort", () => inner.abort(), { once: true });
  let next = 0;
  const worker = async () => {
    try {
      for (;;) {
        const index = todo[next++];
        if (index === undefined) return;
        const offset = index * chunkSize;
        const piece = file.slice(offset, offset + pieceSize(index));
        for (let attempt = 1; ; attempt++) {
          try {
            await putPiece(`/api/bg-uploads/${id}?offset=${offset}`, piece, inner.signal, (loaded) => {
              inFlight.set(index, loaded);
              report();
            });
            break;
          } catch (err) {
            inFlight.delete(index);
            if (inner.signal.aborted || attempt >= PIECE_ATTEMPTS) throw err;
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
        inFlight.delete(index);
        finished += pieceSize(index);
        report();
      }
    } catch (err) {
      inner.abort(); // One piece that can't be sent ends the upload — stop the other connections too. What arrived stays, so a retry resumes.
      throw err;
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONNECTIONS, todo.length) }, worker));

  const check = await call<{ upload: { complete: boolean } }>(`/api/bg-uploads/${id}`);
  if (!check.upload.complete) throw new Error("The server didn't receive the whole file. Try again — only the missing parts will be sent.");
  return ref;
}

/** The server's saved copy of a zip as something the zip reader can open piece by piece. */
export function remoteSourceForRef(ref: BgZipRef, name: string, size: number): RemoteZipSource {
  const url = ref.kind === "drive" ? `/api/gdrive/file/${encodeURIComponent(ref.id)}` : `/api/bg-uploads/${encodeURIComponent(ref.id)}/file`;
  return { kind: "remote", url, size, name };
}

/** Which server zip a zip the page has open came from, or null for one picked from this computer that isn't uploaded. */
export function refOfRemoteSource(source: { kind?: string; url?: string }): BgZipRef | null {
  if (source.kind !== "remote" || !source.url) return null;
  const drive = /^\/api\/gdrive\/file\/([^/?#]+)/.exec(source.url);
  if (drive) return { kind: "drive", id: decodeURIComponent(drive[1]) };
  const upload = /^\/api\/bg-uploads\/([^/?#]+)\/file/.exec(source.url);
  return upload ? { kind: "upload", id: decodeURIComponent(upload[1]) } : null;
}

/** What the page remembers on the server between visits: which zip is open and what was selected. */
export interface BgWorkspace {
  zip: { ref: BgZipRef; name: string; size: number } | null;
  /** Shot numbers chosen for column A and B, and per-image column-A overrides. */
  selectedIndices: number[];
  secondaryIndices: number[];
  manualOverridesA: [string, string][];
  convertTo: string;
  /** The settings the page already keeps per browser, saved here too so another browser gets them. */
  settings: unknown;
}

export const bgWorkspace = {
  load: async (): Promise<BgWorkspace | null> => (await call<{ workspace: BgWorkspace | null }>("/api/bg-workspace")).workspace,
  save: async (workspace: BgWorkspace): Promise<void> => {
    await call<{ ok: boolean }>("/api/bg-workspace", json("PUT", workspace));
  },
};
