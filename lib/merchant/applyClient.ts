import type { ApplyItem, ApplyOutcome, ApplyRequest, HistoryEntry } from "./types";

/** Browser side of the apply route: sends changes in parallel batches and reports each outcome as it lands. */

const BATCH_SIZE = 10;
const PARALLEL_REQUESTS = 3;
const REQUEST_TIMEOUT_MS = 180_000;

export interface ClientChange {
  /** What identifies the change to the caller (a SKU, a product id…). */
  key: string;
  item: ApplyItem;
  entries?: HistoryEntry[];
}

export interface ClientOutcome {
  key: string;
  outcome: ApplyOutcome;
}

/** A new id for one run's history — shared by every batch of that run. */
export function newRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function sendBatch(batch: ClientChange[], history: ApplyRequest["history"]): Promise<ClientOutcome[]> {
  const failAll = (error: string): ClientOutcome[] => batch.map((change) => ({ key: change.key, outcome: { ok: false, error } }));
  try {
    const response = await fetch("/api/merchant/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batch.map(({ item, entries }) => ({ item, entries })), history } satisfies ApplyRequest),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as { outcomes?: ApplyOutcome[]; error?: string } | null;
    if (!response.ok || !body?.outcomes) return failAll(body?.error ?? `The server answered ${response.status}.`);
    return batch.map((change, index) => ({ key: change.key, outcome: body.outcomes?.[index] ?? { ok: false, error: "No answer for this change." } }));
  } catch (err) {
    return failAll(`The request didn't reach the server (${err instanceof Error ? err.message : "no details"}).`);
  }
}

/**
 * Runs the changes in batches, a few batches at once. `shouldStop` is checked before each batch starts, so
 * Stop ends the run after the batches already in flight finish. Always resolves with every outcome it got.
 */
export async function runChanges(
  changes: ClientChange[],
  hooks: {
    history?: ApplyRequest["history"];
    shouldStop?: () => boolean;
    onOutcomes?: (outcomes: ClientOutcome[]) => void;
  } = {},
): Promise<ClientOutcome[]> {
  const batches: ClientChange[][] = [];
  for (let index = 0; index < changes.length; index += BATCH_SIZE) batches.push(changes.slice(index, index + BATCH_SIZE));
  const all: ClientOutcome[] = [];
  let cursor = 0;
  const worker = async () => {
    while (!hooks.shouldStop?.()) {
      const batch = batches[cursor++];
      if (!batch) return;
      const outcomes = await sendBatch(batch, hooks.history);
      all.push(...outcomes);
      hooks.onOutcomes?.(outcomes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, batches.length) }, worker));
  return all;
}
