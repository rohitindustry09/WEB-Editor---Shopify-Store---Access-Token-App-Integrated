import { NextResponse } from "next/server";
import { guardOpen } from "@/lib/auth/openGuard";
import { serveFileWithRange } from "@/lib/serveFile";
import { resolveZip } from "@/lib/serverZips";

export const dynamic = "force-dynamic";

/** Serves an uploaded zip from the server's disk with `Range` support, so the page reads only the parts it needs. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const zip = await resolveZip({ kind: "upload", id: (await params).id }, visitor);
  if (!zip) return NextResponse.json({ error: "That upload isn't finished or no longer exists." }, { status: 404 });
  return serveFileWithRange(request, zip.path, zip.size);
}
