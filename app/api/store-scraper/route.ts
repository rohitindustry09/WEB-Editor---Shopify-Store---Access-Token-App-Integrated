import { guardApi } from "@/lib/auth/apiGuard";
import { NextResponse, after } from "next/server";
import { startJob, runScrapeJob } from "@/lib/storeScraper/jobRunner";
import { listJobs } from "@/lib/storeScraper/store";
import { summarizeJob, type ScrapeJobOptions, type ScraperPlatform, type ScrapeScope } from "@/lib/storeScraper/types";

const PLATFORMS: ScraperPlatform[] = ["shopify", "wordpress", "magento"];
const SCOPES: ScrapeScope[] = ["collection", "store"];

function parseLines(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const jobs = listJobs().map(summarizeJob);
  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const platform = payload.platform;
  const scope = payload.scope;
  const inputUrl = payload.inputUrl;

  if (typeof platform !== "string" || !PLATFORMS.includes(platform as ScraperPlatform)) {
    return NextResponse.json({ error: "Pick a platform." }, { status: 400 });
  }
  if (typeof scope !== "string" || !SCOPES.includes(scope as ScrapeScope)) {
    return NextResponse.json({ error: "Pick a scope." }, { status: 400 });
  }
  if (typeof inputUrl !== "string" || inputUrl.trim().length === 0) {
    return NextResponse.json({ error: "Enter a store URL." }, { status: 400 });
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(inputUrl.trim()).toString();
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
  }

  const options: ScrapeJobOptions = {
    platform: platform as ScraperPlatform,
    scope: scope as ScrapeScope,
    inputUrl: normalizedUrl,
    requestedFields: parseLines(payload.requestedFields),
    containerClasses: parseLines(payload.containerClasses),
    useCache: Boolean(payload.useCache),
    allowInsecureTls: Boolean(payload.allowInsecureTls),
    quickMediaMode: Boolean(payload.quickMediaMode),
  };

  const job = startJob(options);
  // Only a freshly created job (status "queued") needs to actually run — a
  // cache hit comes back already "done" and must not be re-scraped.
  // Scheduled via Next.js's own `after()` rather than a bare un-awaited
  // promise, so the scrape keeps running past this handler returning its
  // response regardless of runtime (see jobRunner.ts's own note on this).
  if (job.status === "queued") {
    after(() => runScrapeJob(job.id));
  }
  return NextResponse.json({ job: summarizeJob(job) });
}
