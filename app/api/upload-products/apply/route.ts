import { NextResponse } from "next/server";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { getSession } from "@/lib/shopify/session";
import { isSameOrigin } from "@/lib/sameOrigin";
import { applyRow } from "@/lib/uploadApply";
import type { ApplyItem } from "@/lib/skuApply";

export const dynamic = "force-dynamic";

/**
 * Applies ONE Upload & Update row. The client runs several of these at once
 * (its "workers"): unlike server actions, which Next.js queues one after
 * another, separate route requests really do run in parallel.
 */
export async function POST(request: Request) {
  if (!(await getAuthenticatedStore()) || !(await getSession())) {
    return NextResponse.json({ error: "You're signed out or not connected to a store." }, { status: 401 });
  }

  // A cookie-authenticated write must come from this site's own pages.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }

  let item: ApplyItem;
  try {
    item = ((await request.json()) as { item: ApplyItem }).item;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  return NextResponse.json({ result: await applyRow(item) });
}
