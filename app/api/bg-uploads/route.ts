import { NextResponse } from "next/server";
import { guardOpen } from "@/lib/auth/openGuard";
import { beginUpload, listUploads } from "@/lib/serverZips";

export const dynamic = "force-dynamic";

/** Zips uploaded to the server from this computer. */
export async function GET(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  return NextResponse.json({ uploads: await listUploads(visitor) });
}

/** `{ name, size }` starts an upload; the browser then sends the file in pieces to `/api/bg-uploads/<id>?offset=…`. */
export async function POST(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const body = (await request.json().catch(() => null)) as { name?: unknown; size?: unknown; fingerprint?: unknown } | null;
  if (typeof body?.name !== "string" || typeof body.size !== "number") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json({ upload: await beginUpload(body.name, body.size, visitor, typeof body.fingerprint === "string" ? body.fingerprint.slice(0, 400) : "") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't start the upload." }, { status: 422 });
  }
}
