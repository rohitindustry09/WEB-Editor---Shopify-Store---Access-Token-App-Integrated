import "server-only";
import { driveDownloadUrl, filenameFromDisposition, isAllowedDriveHost, parseConfirmForm } from "./googleDrive";

const FETCH_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; StoreEditor/1.0)" };

/** A problem Drive reported (not shared, quota, wrong link). `fatal` means trying again won't help. */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
  ) {
    super(message);
  }
}

export interface DriveStream {
  body: ReadableStream<Uint8Array>;
  /** The whole file's size, when Drive says. */
  total: number | null;
  name: string | null;
  /** True when Drive served just the requested bytes; false when it sent the whole file anyway. */
  rangeHonoured: boolean;
}

const isHtml = (response: Response): boolean => (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");

/** Turns Drive's error page into a sentence the user can act on. */
function explainHtml(html: string, status: number): string {
  if (/too many users have viewed or downloaded|quota exceeded/i.test(html)) {
    return "Google Drive has temporarily blocked downloads of this file (too many people have downloaded it). Try again later.";
  }
  if (status === 404 || /not found|can't be found/i.test(html)) return "Google Drive couldn't find that file. Check the link.";
  return "Google Drive wouldn't hand the file over. In Drive, set the file's sharing to \"Anyone with the link\" (Viewer), then try again.";
}

/** The file's full size, from a 206's `Content-Range: bytes 0-99/1234` or a plain 200's Content-Length. */
function totalSize(response: Response): number | null {
  const fromRange = /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "")?.[1];
  const value = Number(fromRange ?? response.headers.get("content-length"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Opens a public Drive file (optionally just bytes `start`–`end`, inclusive). Only the file ID is used: the Google address is
 * built here, so nothing a user pastes can point the server at another host.
 */
export async function openDriveStream(fileId: string, range: { start: number; end: number } | null, signal: AbortSignal): Promise<DriveStream> {
  const headers: Record<string, string> = range ? { ...FETCH_HEADERS, Range: `bytes=${range.start}-${range.end}` } : FETCH_HEADERS;

  let response = await fetch(driveDownloadUrl(fileId), { headers, signal });
  if (isHtml(response)) {
    // Large files can answer with a "download anyway" page instead; submit its form once, to Google's own host only.
    const html = await response.text();
    const form = parseConfirmForm(html);
    if (!form || !isAllowedDriveHost(form.action)) throw new DriveError(explainHtml(html, response.status), true);
    response = await fetch(`${form.action}?${form.params.toString()}`, { headers, signal });
    if (isHtml(response)) throw new DriveError(explainHtml(await response.text(), response.status), true);
  }
  if (!response.ok || !response.body) {
    // 4xx is about the link or its sharing; 5xx and network trouble are worth another try.
    throw new DriveError(`Google Drive answered ${response.status}.`, response.status >= 400 && response.status < 500);
  }
  return {
    body: response.body,
    total: totalSize(response),
    name: filenameFromDisposition(response.headers.get("content-disposition")),
    rangeHonoured: response.status === 206,
  };
}
