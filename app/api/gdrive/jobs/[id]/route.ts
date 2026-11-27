import { NextResponse } from "next/server";
import { guardApi } from "@/lib/auth/apiGuard";
import { discardDriveJob, getDriveJob, pauseDriveJob } from "@/lib/driveJobs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** One download's live progress — the page polls this. */
export async function GET(request: Request, { params }: Context) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const job = await getDriveJob((await params).id);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "No such download." }, { status: 404 });
}

/** `{ "action": "pause" }` stops a running download but keeps what's saved, so it can be resumed. */
export async function PATCH(request: Request, { params }: Context) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "pause") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const job = await pauseDriveJob((await params).id);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "No such download." }, { status: 404 });
}

/** Stops the download (if running) and deletes everything saved for it. */
export async function DELETE(request: Request, { params }: Context) {
  const denied = await guardApi(request);
  if (denied) return denied;
  await discardDriveJob((await params).id);
  return NextResponse.json({ ok: true });
}
