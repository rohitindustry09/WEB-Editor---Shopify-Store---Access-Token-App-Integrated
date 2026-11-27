import { NextResponse } from "next/server";
import { guardOpen } from "@/lib/auth/openGuard";
import type { BgJobSpec } from "@/lib/bgJobTypes";
import { ASSET_ID } from "@/lib/bgJobTypes";
import { createBgJob, listBgJobs, validateSpec } from "@/lib/bgJobs";

export const dynamic = "force-dynamic";

const MAX_ASSET_BYTES = 50 * 1024 ** 2;

/** Every Background customiser run on the server — running, finished or stopped. */
export async function GET(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;
  return NextResponse.json({ jobs: await listBgJobs(visitor) });
}

/**
 * Starts a run on the server. Multipart form: a `spec` field (the run's settings and image list, as JSON) plus one file per
 * picture the run needs (a background image, the logo), named by the asset id the spec refers to. The server starts on it
 * straight away and keeps going whether or not this page stays open.
 */
export async function POST(request: Request) {
  const open = await guardOpen(request);
  if (open.denied) return open.denied;
  const visitor = open.visitor;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const rawSpec = form.get("spec");
  if (typeof rawSpec !== "string") return NextResponse.json({ error: "Missing the run's settings." }, { status: 400 });
  let spec: BgJobSpec;
  try {
    spec = JSON.parse(rawSpec) as BgJobSpec;
  } catch {
    return NextResponse.json({ error: "The run's settings are not valid." }, { status: 400 });
  }

  const assets = new Map<string, Uint8Array>();
  for (const [name, value] of form.entries()) {
    if (name === "spec" || !(value instanceof File)) continue;
    if (!ASSET_ID.test(name) || value.size > MAX_ASSET_BYTES) return NextResponse.json({ error: "A picture sent with the run is invalid or too large." }, { status: 400 });
    assets.set(name, new Uint8Array(await value.arrayBuffer()));
  }

  const problem = await validateSpec(spec, new Set(assets.keys()), visitor);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  try {
    return NextResponse.json({ job: await createBgJob(spec, assets, visitor) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't start the run." }, { status: 500 });
  }
}
