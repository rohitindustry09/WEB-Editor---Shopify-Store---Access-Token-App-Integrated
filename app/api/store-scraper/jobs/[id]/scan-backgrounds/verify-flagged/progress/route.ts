import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getExportProgress } from "@/lib/storeScraper/exportProgress";

/** Tiny side-channel the client polls while `verify-flagged`'s own long-running request is still in flight — mirrors the main scan's `progress/route.ts`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(_request);
  if (denied) return denied;
  const { id } = await params;
  const progress = getExportProgress(`${id}:verify-flagged`);
  return NextResponse.json(progress ?? { done: 0, total: 0 });
}
