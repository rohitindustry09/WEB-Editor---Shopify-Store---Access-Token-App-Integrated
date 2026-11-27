import { NextResponse } from "next/server";
import { guardOpen } from "@/lib/auth/openGuard";
import { cancelBgJob, deleteBgJob, getBgJob } from "@/lib/bgJobs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** One run's live progress — the page polls this. */
export async function GET(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const job = await getBgJob((await params).id, visitor);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "No such run." }, { status: 404 });
}

/** `{ "action": "cancel" }` stops a run; what it finished stays and can still be downloaded. */
export async function PATCH(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "cancel") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const job = await cancelBgJob((await params).id, visitor);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "No such run." }, { status: 404 });
}

/** Stops the run (if running) and deletes everything saved for it, results included. */
export async function DELETE(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  await deleteBgJob((await params).id, visitor);
  return NextResponse.json({ ok: true });
}
