import { NextResponse } from "next/server";
import { guardOpen } from "@/lib/auth/openGuard";
import { savedZip } from "@/lib/driveJobs";
import { serveFileWithRange } from "@/lib/serveFile";

export const dynamic = "force-dynamic";

/** Serves a finished Drive download from the server's disk, with `Range` support, so the page reads only what it needs. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;

  const saved = await savedZip(visitor, (await params).id);
  if (!saved) return NextResponse.json({ error: "That download isn't finished or no longer exists." }, { status: 404 });
  return serveFileWithRange(request, saved.path, saved.size);
}
