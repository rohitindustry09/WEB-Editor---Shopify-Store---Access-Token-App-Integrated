import { NextResponse } from "next/server";
import { guardOpen } from "@/lib/auth/openGuard";
import { DriveError } from "@/lib/driveFetch";
import { listDriveJobs, startDriveJob } from "@/lib/driveJobs";
import { parseDriveLink } from "@/lib/googleDrive";

export const dynamic = "force-dynamic";

/** Every Google Drive download the server knows about — running, stopped or finished. */
export async function GET(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  return NextResponse.json({ jobs: await listDriveJobs(visitor) });
}

/**
 * Starts downloading a public Drive file ON THE SERVER and returns right away; the download carries on whether or not
 * this page stays open. A stopped download for the same file is resumed from what's already saved.
 */
export async function POST(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const link = parseDriveLink(url);
  if (link.kind === "folder") {
    return NextResponse.json({ error: "That's a folder link. Google Drive can't send a whole folder as one file — zip it first, then share the zip." }, { status: 400 });
  }
  if (link.kind !== "file") {
    return NextResponse.json({ error: "That doesn't look like a Google Drive file link, e.g. https://drive.google.com/file/d/…/view" }, { status: 400 });
  }

  try {
    return NextResponse.json({ job: await startDriveJob(url, visitor) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't start the download.";
    return NextResponse.json({ error: message }, { status: err instanceof DriveError && err.fatal ? 422 : 500 });
  }
}
