import "server-only";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

/** "bytes=0-99", "bytes=100-" or "bytes=-500" against a file of `size` bytes → inclusive start/end, or null when it can't be met. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

export interface ServeFileOptions {
  /** Makes the browser save it under this name (a download) instead of showing it. */
  filename?: string;
  /** The file's last-modified time. With it the reply carries an ETag, which is what lets a browser RESUME an interrupted download. */
  modified?: Date;
  contentType?: string;
}

/** A name safe in a Content-Disposition header: plain ASCII for old clients, plus the exact UTF-8 name. */
function dispositionFor(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Serves a file from disk with `Range` support, so the page can read just the parts of a big zip it needs (its index, then
 * one picture at a time) instead of ever downloading the whole file — and so a download that was interrupted can pick up where
 * it stopped. With `modified` the reply has an ETag and Last-Modified, and an `If-Range` that no longer matches (the file
 * changed) correctly gets the whole file again instead of a mismatched piece.
 */
export function serveFileWithRange(request: Request, filePath: string, size: number, options: ServeFileOptions = {}): Response {
  const etag = options.modified ? `"${size.toString(16)}-${Math.floor(options.modified.getTime()).toString(16)}"` : null;
  const lastModified = options.modified?.toUTCString() ?? null;

  const rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const rangeStillValid = !ifRange || ifRange === etag || ifRange === lastModified;
  const range = rangeHeader && rangeStillValid ? parseRange(rangeHeader, size) : null;
  if (rangeHeader && rangeStillValid && !range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const headers = new Headers({
    "Content-Type": options.contentType ?? "application/zip",
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "private, no-store",
  });
  if (etag) headers.set("ETag", etag);
  if (lastModified) headers.set("Last-Modified", lastModified);
  if (options.filename) {
    headers.set("Content-Disposition", dispositionFor(options.filename));
    // For a big download, tell nginx (if it sits in front) to pass bytes straight through instead of copying them to temp files first.
    headers.set("X-Accel-Buffering", "no");
  }
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  // A big buffer: a multi-gigabyte download is one long read, and the default 64 KB makes it needlessly chatty.
  const stream = createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
  request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
