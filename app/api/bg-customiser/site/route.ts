import { NextResponse } from "next/server";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { guardApi } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads", "background-customiser");
/** The same characters the save route replaces when it builds a folder name. */
const UNSAFE_PATH_CHARS = /[\\/:*?"<>|]/g;

/**
 * "Start fresh": deletes everything the Background customiser saved on the server for one site — its folder under
 * `uploads/background-customiser/` and the per-conversion variants (`<site>__<setup>`) that sit next to it.
 * Folder names come from listing the directory, never from the request, so nothing outside the uploads folder can be reached.
 */
export async function DELETE(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;

  const site = new URL(request.url).searchParams.get("site")?.trim() ?? "";
  const segment = site.replace(UNSAFE_PATH_CHARS, "-").trim();
  if (!segment || segment === "." || segment === "..") {
    return NextResponse.json({ ok: false, error: "Missing or invalid site name." }, { status: 400 });
  }

  let entries: { name: string; isDirectory: () => boolean }[] = [];
  try {
    entries = await readdir(UPLOADS_ROOT, { withFileTypes: true });
  } catch {
    return NextResponse.json({ ok: true, removed: [] }); // Nothing was ever saved.
  }

  const targets = entries.filter((entry) => entry.isDirectory() && (entry.name === segment || entry.name.startsWith(`${segment}__`)));
  try {
    for (const target of targets) await rm(path.join(UPLOADS_ROOT, target.name), { recursive: true, force: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Couldn't delete the saved files." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, removed: targets.map((target) => target.name) });
}
