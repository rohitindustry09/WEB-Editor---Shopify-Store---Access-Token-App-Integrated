import { NextResponse } from "next/server";
import { guardApi } from "@/lib/auth/apiGuard";
import { mapWithConcurrency } from "@/lib/concurrency";
import { applyMerchantItem } from "@/lib/merchant/apply";
import { appendEntries, isValidRunId } from "@/lib/merchant/history";
import type { ApplyOutcome, ApplyRequest, HistoryEntry } from "@/lib/merchant/types";
import { getSession } from "@/lib/shopify/session";

export const dynamic = "force-dynamic";

const MAX_ITEMS_PER_REQUEST = 40;
const PARALLEL_ITEMS = 4;

/**
 * Applies a batch of Merchant Tools changes (prices, image alt text, SEO, redirects) a few at a time, and
 * records the successful ones in the change history so the run can be reverted. The client sends several
 * batches at once; unlike server actions, separate route requests really do run in parallel.
 */
export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not connected to a store." }, { status: 401 });

  let body: ApplyRequest;
  try {
    body = (await request.json()) as ApplyRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS_PER_REQUEST) {
    return NextResponse.json({ ok: false, error: "Too many changes in one request." }, { status: 400 });
  }
  if (!body.items.every((entry) => typeof entry === "object" && entry !== null && typeof entry.item === "object" && entry.item !== null)) {
    return NextResponse.json({ ok: false, error: "Invalid change list." }, { status: 400 });
  }
  if (body.history !== undefined && !isValidRunId(body.history?.runId)) {
    return NextResponse.json({ ok: false, error: "Invalid history run." }, { status: 400 });
  }

  const outcomes: ApplyOutcome[] = await mapWithConcurrency(body.items, PARALLEL_ITEMS, async ({ item }) => applyMerchantItem(item));

  let historySaved = true;
  if (body.history) {
    const entries: HistoryEntry[] = [];
    body.items.forEach(({ item, entries: itemEntries }, index) => {
      const outcome = outcomes[index];
      if (!outcome.ok) return;
      if (item.kind === "redirectCreate" && outcome.createdId) {
        entries.push({ kind: "redirect", redirectId: outcome.createdId, label: item.path, path: item.path, target: item.target });
      } else if (Array.isArray(itemEntries)) {
        entries.push(...itemEntries);
      }
    });
    historySaved = await appendEntries(session.shop, { runId: body.history.runId, tool: String(body.history.tool), label: String(body.history.label) }, entries).then(
      () => true,
      () => false,
    );
  }

  return NextResponse.json({ ok: true, outcomes, historySaved });
}
