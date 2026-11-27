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

/**
 * Serves a file from disk with `Range` support, so the page can read just the parts of a big zip it needs (its index, then
 * one picture at a time) instead of ever downloading the whole file.
 */
export function serveFileWithRange(request: Request, filePath: string, size: number): Response {
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;
  if (rangeHeader && !range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const headers = new Headers({
    "Content-Type": "application/zip",
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "private, no-store",
  });
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  const stream = createReadStream(filePath, { start, end });
  request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
