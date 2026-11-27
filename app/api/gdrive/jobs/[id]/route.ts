import { NextResponse } from "next/server";
import { guardOpen } from "@/lib/auth/openGuard";
import { discardDriveJob, getDriveJob, pauseDriveJob } from "@/lib/driveJobs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** One download's live progress — the page polls this. */
export async function GET(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const job = await getDriveJob((await params).id, visitor);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "No such download." }, { status: 404 });
}

/** `{ "action": "pause" }` stops a running download but keeps what's saved, so it can be resumed. */
export async function PATCH(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "pause") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const job = await pauseDriveJob((await params).id, visitor);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "No such download." }, { status: 404 });
}

/** Stops the download (if running) and deletes everything saved for it. */
export async function DELETE(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  await discardDriveJob((await params).id, visitor);
  return NextResponse.json({ ok: true });
}
