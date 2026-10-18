import type { ApplyItem, ApplyResult } from "@/lib/skuApply";

/** A product that gets no answer in this long is reported as failed instead of holding its worker forever. */
const REQUEST_TIMEOUT_MS = 180_000;

export const MAX_WORKERS = 50;
export const DEFAULT_WORKERS = 3;

export interface WorkerEntry<K> {
  /** What identifies the row to the caller — usually the SKU. */
  key: K;
  item: ApplyItem;
}

export interface WorkerOutcome<K> {
  key: K;
  action: "update" | "create";
  result: ApplyResult;
}

/** Sends one row to the server and always resolves with a result — a network failure becomes a failed row, never a crash. */
async function applyRow(item: ApplyItem): Promise<ApplyResult> {
  try {
    const response = await fetch("/api/upload-products/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as { result?: ApplyResult; error?: string } | null;
    if (!response.ok || !body?.result) return { ok: false, error: body?.error ?? `The server answered ${response.status}.` };
    return body.result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "no details";
    return { ok: false, error: `The request didn't reach the server (${reason}). Use Retry — a product that was already created is found by its SKU and finished, not duplicated.` };
  }
}

const NETWORK_RETRIES = 2;
const NETWORK_RETRY_DELAY_MS = 1500;
const DROPPED_CONNECTION = "The request didn't reach the server";

/** Updating is safe to repeat, so a dropped connection is retried a couple of times before the row is reported as failed. */
async function applyRowWithRetry(item: ApplyItem): Promise<ApplyResult> {
  let result = await applyRow(item);
  for (let attempt = 0; attempt < NETWORK_RETRIES && item.kind === "update" && !result.ok && (result.error ?? "").startsWith(DROPPED_CONNECTION); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS * (attempt + 1)));
    result = await applyRow(item);
  }
  return result;
}

/**
 * Runs the rows with a pool of workers: each worker takes the next waiting row,
 * finishes it completely (create, variant, metafields, publishing) and only then
 * takes another. `shouldStop` is checked before a worker starts a row, so Stop
 * ends the run once the rows already in flight finish — nothing is abandoned
 * half-written.
 */
export async function runApplyWorkers<K>(
  entries: WorkerEntry<K>[],
  hooks: {
    workers: number;
    shouldStop: () => boolean;
    onOutcomes: (outcomes: WorkerOutcome<K>[]) => void;
    onStart?: (keys: K[]) => void;
  },
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (!hooks.shouldStop()) {
      const index = cursor++;
      if (index >= entries.length) return;
      const entry = entries[index];
      hooks.onStart?.([entry.key]);
      const result = await applyRowWithRetry(entry.item);
      hooks.onOutcomes([{ key: entry.key, action: entry.item.kind, result }]);
    }
  };
  const count = Math.max(1, Math.min(MAX_WORKERS, Math.floor(hooks.workers) || 1));
  await Promise.all(Array.from({ length: Math.min(count, entries.length) }, worker));
}
