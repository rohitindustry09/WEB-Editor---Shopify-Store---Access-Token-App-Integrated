import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { mkdir, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";

/**
 * Saves one processed image to local disk at
 * `uploads/background-customiser/<website>/<SKU>/<filename>` — the exact
 * same layout the store scraper's own `uploads/<site>/<SKU>/` folder
 * uses, so a future feature can read straight from disk instead of
 * re-processing. Skips a write when the file is already there, which is
 * what makes re-running this tool on the same zip fast the second time.
 */
const UPLOADS_ROOT = path.join(process.cwd(), "uploads", "background-customiser");

const UNSAFE_PATH_CHARS = /[\\/:*?"<>|]/g;

function sanitizeSegment(value: string): string {
  return value.replace(UNSAFE_PATH_CHARS, "-").trim();
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
  const denied = await guardApi(request);
  if (denied) return denied;
  try {
    const formData = await request.formData();
    const website = formData.get("website");
    const sku = formData.get("sku");
    const filename = formData.get("filename");
    const file = formData.get("file");

    if (typeof website !== "string" || !website.trim()) {
      return NextResponse.json({ ok: false, error: "Missing website folder name." }, { status: 400 });
    }
    if (typeof sku !== "string" || !sku.trim()) {
      return NextResponse.json({ ok: false, error: "Missing SKU." }, { status: 400 });
    }
    if (typeof filename !== "string" || !filename.trim()) {
      return NextResponse.json({ ok: false, error: "Missing filename." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file." }, { status: 400 });
    }

    const siteDir = path.join(UPLOADS_ROOT, sanitizeSegment(website.trim()));
    const skuDir = path.join(siteDir, sanitizeSegment(sku.trim().toUpperCase()));
    await mkdir(skuDir, { recursive: true });

    const finalPath = path.join(skuDir, sanitizeSegment(filename.trim()));
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
