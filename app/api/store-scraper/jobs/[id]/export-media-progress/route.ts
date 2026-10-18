import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getExportProgress } from "@/lib/storeScraper/exportProgress";

/** Polled by the client while a media zip download is in flight — the download itself is a raw byte stream, so this small side-channel is how "N of M products zipped" progress reaches the UI. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(_request);
  if (denied) return denied;
  const { id } = await params;
  const progress = getExportProgress(id);
  return NextResponse.json(progress ?? { done: 0, total: 0 });
}
