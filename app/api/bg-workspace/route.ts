import { NextResponse } from "next/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { guardOpen } from "@/lib/auth/openGuard";

export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "uploads", "bg-workspace");
/** One file per anonymous visitor (the ID is a UUID, so it is safe as a file name). */
const fileFor = (visitor: string): string => path.join(DIR, `${visitor}.json`);
const MAX_BYTES = 2 * 1024 ** 2;

/** What the Background customiser page remembers between visits (open zip, selection, settings) — kept on the server so it follows you to any browser. */
export async function GET(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  try {
    return NextResponse.json({ workspace: JSON.parse(await readFile(fileFor(visitor), "utf-8")) as unknown });
  } catch {
    return NextResponse.json({ workspace: null });
  }
}

export async function PUT(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "The saved workspace is too large." }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  try {
    await mkdir(DIR, { recursive: true });
    const temp = `${fileFor(visitor)}.tmp`;
    await writeFile(temp, text);
    await rename(temp, fileFor(visitor));
  } catch {
    return NextResponse.json({ error: "This server can't save files, so the workspace can't be remembered." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
