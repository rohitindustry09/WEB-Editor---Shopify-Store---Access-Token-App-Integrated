import { NextResponse } from "next/server";
import { guardOpen } from "@/lib/auth/openGuard";
import { appendUploadChunk, deleteUpload, getUpload } from "@/lib/serverZips";

export const dynamic = "force-dynamic";

/** The pieces are small, but a bad client must not be able to make the server buffer an unbounded body. */
const MAX_CHUNK_BYTES = 32 * 1024 ** 2;

type Context = { params: Promise<{ id: string }> };

/** How much of the file the server already has — what a resumed upload asks first. */
export async function GET(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const upload = await getUpload((await params).id, visitor);
  return upload ? NextResponse.json({ upload }) : NextResponse.json({ error: "No such upload." }, { status: 404 });
}

/** Appends one piece of the file. `?offset=` must be exactly how many bytes the server already has. */
export async function PUT(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: "Missing or invalid offset." }, { status: 400 });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_CHUNK_BYTES) return NextResponse.json({ error: "That piece is too large." }, { status: 413 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_CHUNK_BYTES) return NextResponse.json({ error: "That piece is too large." }, { status: 413 });
  try {
    return NextResponse.json({ upload: await appendUploadChunk((await params).id, offset, bytes, visitor) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save that piece." }, { status: 409 });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  await deleteUpload((await params).id, visitor);
  return NextResponse.json({ ok: true });
}
