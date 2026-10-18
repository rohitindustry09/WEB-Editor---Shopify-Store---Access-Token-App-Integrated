import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/storeScraper/store";
import { buildShopifyImportCsv } from "@/lib/storeScraper/shopifyImportCsv";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const { csv, cappedProductCount } = buildShopifyImportCsv(job.products, job.options.requestedFields);
  const body = "﻿" + csv;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${new URL(job.options.inputUrl).hostname}-shopify-import.csv"`,
      "X-Capped-Products-Count": String(cappedProductCount),
    },
  });
}
