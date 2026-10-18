import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/storeScraper/store";
import { cancelJob } from "@/lib/storeScraper/jobRunner";
import { summarizeJob } from "@/lib/storeScraper/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  if (job.status === "discovering" || job.status === "scraping" || job.status === "queued") {
    cancelJob(id);
  }

  return NextResponse.json({ job: summarizeJob(job) });
}
