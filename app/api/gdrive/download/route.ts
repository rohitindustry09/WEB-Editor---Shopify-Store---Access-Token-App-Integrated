import { NextResponse } from "next/server";
import { guardApi } from "@/lib/auth/apiGuard";
import { driveDownloadUrl, filenameFromDisposition, isAllowedDriveHost, parseConfirmForm, parseDriveLink } from "@/lib/googleDrive";

export const dynamic = "force-dynamic";
/** A big zip takes a while to stream through; hosts that cap function time still apply their own limit. */
export const maxDuration = 300;

/** The browser has to hold the whole zip in memory while it reads it, so a link past this is refused up front. */
const MAX_BYTES = 4 * 1024 ** 3;
const FETCH_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; StoreEditor/1.0)" };

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
const isHtml = (response: Response): boolean => (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");

/** Turns Drive's error page into a sentence the user can act on. */
function explainHtml(html: string, status: number): string {
  if (/too many users have viewed or downloaded|quota exceeded/i.test(html)) {
    return "Google Drive has temporarily blocked downloads of this file (too many people have downloaded it). Try again later, or download it yourself and add the zip directly.";
  }
  if (status === 404 || /not found|can't be found/i.test(html)) return "Google Drive couldn't find that file. Check the link.";
  return "Google Drive wouldn't hand the file over. In Drive, set the file's sharing to \"Anyone with the link\" (Viewer), then try again.";
}

/**
 * Downloads a public Google Drive file on the user's behalf and streams it back. The browser can't do this itself
 * (Drive sends no CORS headers). Only the file ID from the pasted link is used — the Google address is built here.
 */
export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.", 400);
  }
  const link = parseDriveLink(typeof body.url === "string" ? body.url : "");
  if (link.kind === "folder") return fail("That's a folder link. Google Drive can't send a whole folder as one file — zip it first, then share the zip.", 400);
  if (link.kind !== "file") return fail("That doesn't look like a Google Drive file link, e.g. https://drive.google.com/file/d/…/view", 400);

  try {
    let upstream = await fetch(driveDownloadUrl(link.id), { headers: FETCH_HEADERS, signal: request.signal });
    if (isHtml(upstream)) {
      // Large files can answer with a "download anyway" page instead; submit its form once, to Google's own host only.
      const html = await upstream.text();
      const form = parseConfirmForm(html);
      if (!form || !isAllowedDriveHost(form.action)) return fail(explainHtml(html, upstream.status), 422);
      upstream = await fetch(`${form.action}?${form.params.toString()}`, { headers: FETCH_HEADERS, signal: request.signal });
      if (isHtml(upstream)) return fail(explainHtml(await upstream.text(), upstream.status), 422);
    }
    if (!upstream.ok || !upstream.body) return fail(`Google Drive answered ${upstream.status}.`, 502);

    const length = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BYTES) {
      await upstream.body.cancel();
      return fail("This file is too large to bring in through a link (over 4 GB). Download it and add the zip directly.", 413);
    }

    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Drive-Filename": encodeURIComponent(filenameFromDisposition(upstream.headers.get("content-disposition")) ?? "drive-download.zip"),
    });
    if (Number.isFinite(length) && length > 0) headers.set("Content-Length", String(length));
    return new Response(upstream.body, { headers });
  } catch (err) {
    if (request.signal.aborted) return fail("Cancelled.", 499);
    return fail(`Couldn't reach Google Drive (${err instanceof Error ? err.message : "no details"}).`, 502);
  }
}
