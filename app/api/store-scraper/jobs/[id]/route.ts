import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/storeScraper/store";
import { summarizeJob } from "@/lib/storeScraper/types";

const DEFAULT_PAGE_SIZE = 50;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE);
  const start = (page - 1) * pageSize;
  const products = job.products.slice(start, start + pageSize);

  return NextResponse.json({
    job: summarizeJob(job),
    products,
    page,
    pageSize,
    failures: job.failures,
  });
}
