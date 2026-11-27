import { guardOpen } from "@/lib/auth/openGuard";
import { NextResponse } from "next/server";
import { mkdir, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";

/**
 * Saves one converted image to local disk at
 * `uploads/Media-format-converter/<batchName>/<relativePath>` — the same
 * on-disk-cache pattern as the background customiser's own
 * `uploads/background-customiser/` and the store scraper's
 * `uploads/<site>/`, so a future run (or the eventual zip export) can
 * read straight from disk instead of re-converting or holding the whole
 * batch in the browser's memory at once. Skips a write when the file is
 * already there, which is what makes re-running this tool on the same
 * zip fast the second time.
 */
const UPLOADS_BASE = path.join(process.cwd(), "uploads", "Media-format-converter");
/** Each anonymous visitor (browser) has its own folder, so nobody can see or delete anyone else's files. */
const rootFor = (visitor: string): string => path.join(UPLOADS_BASE, visitor);

const UNSAFE_NAME_CHARS = /[\\:*?"<>|]/g;

/**
 * `relativePath` comes straight from the browser, so it's untrusted input
 * — sanitized segment by segment (no `..`, no empty segments, no unsafe
 * filesystem characters) rather than trusted as a ready-to-join path.
 * Preserves whatever nested folder structure the original zip had (media
 * converter, unlike the other two tools' uploads/ folders, isn't scoped
 * to a fixed SKU/filename shape).
 */
function sanitizeRelativePath(relativePath: string): string | null {
  const segments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .map((segment) => segment.replace(UNSAFE_NAME_CHARS, "-"));
  return segments.length > 0 ? segments.join("/") : null;
}

function sanitizeSegment(value: string): string {
  return value.replace(UNSAFE_NAME_CHARS, "-").trim();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  try {
    const formData = await request.formData();
    const batchName = formData.get("batchName");
    const relativePath = formData.get("relativePath");
    const file = formData.get("file");

    if (typeof batchName !== "string" || !batchName.trim()) {
      return NextResponse.json({ ok: false, error: "Missing batch name." }, { status: 400 });
    }
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      return NextResponse.json({ ok: false, error: "Missing relative path." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file." }, { status: 400 });
    }

    const safeRelativePath = sanitizeRelativePath(relativePath);
    if (!safeRelativePath) {
      return NextResponse.json({ ok: false, error: "Invalid relative path." }, { status: 400 });
    }

    const batchDir = path.join(rootFor(visitor), sanitizeSegment(batchName.trim()));
    const finalPath = path.join(batchDir, safeRelativePath);

    // Defense in depth beyond `sanitizeRelativePath` — confirms the
    // resolved path genuinely stays inside this batch's own directory
    // before anything is written.
    if (!finalPath.startsWith(batchDir + path.sep) && finalPath !== batchDir) {
      return NextResponse.json({ ok: false, error: "Invalid relative path." }, { status: 400 });
    }

    await mkdir(path.dirname(finalPath), { recursive: true });

    if (await fileExists(finalPath)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const tempPath = `${finalPath}.tmp`;
    await writeFile(tempPath, bytes);
    await rename(tempPath, finalPath);

    return NextResponse.json({ ok: true, skipped: false });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Couldn't save this file." }, { status: 500 });
  }
}
