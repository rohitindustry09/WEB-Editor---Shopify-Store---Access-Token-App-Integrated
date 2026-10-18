"use client";

import { useCallback, useRef, useState } from "react";
import type { ApplyItem } from "@/lib/skuApply";

// Small batches and few requests at once: Shopify rations reads with a cost bucket, and one big query can overdraw it.
const BATCH_SIZE = 10;
const PARALLEL_REQUESTS = 2;
const THROTTLE_RETRIES = 6;
const THROTTLE_PATTERN = /throttl|rate limit|429|50[23]/i;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const REQUEST_TIMEOUT_MS = 120_000;

export interface ScanReasonSummary {
  label: string;
  /** How many scanned products differ in this field. */
  count: number;
  /** One example, so a wrong mapping is easy to spot. */
  sample: { sku: string; expected: string; actual: string };
}

export interface ScanState {
  /** What the scan was run for (mappings, location, …); results only count while the page still matches it. */
  signature: string | null;
  upToDate: ReadonlySet<string>;
  /** Fields that keep products from being up to date, most common first. */
  reasons: ScanReasonSummary[];
  checked: number;
  total: number;
  running: boolean;
  error: string | null;
}

const IDLE: ScanState = { signature: null, upToDate: new Set(), reasons: [], checked: 0, total: 0, running: false, error: null };

interface ScanEntry {
  sku: string;
  item: ApplyItem;
}

interface BatchResult {
  key: string;
  upToDate: boolean;
  reasons: { label: string; expected: string; actual: string }[];
}

async function scanBatch(batch: ScanEntry[]): Promise<BatchResult[]> {
  const items = batch.flatMap(({ sku, item }) =>
    item.kind === "update"
      ? [{ key: sku, productId: item.productId, variantId: item.variantId, values: item.values, metafields: item.metafields ?? [], locationId: item.locationId }]
      : [],
  );
  const response = await fetch("/api/upload-products/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as { results?: BatchResult[]; error?: string } | null;
  if (!response.ok || !body?.results) throw new Error(body?.error ?? `The server answered ${response.status}.`);
  return body.results;
}

/**
 * "Check what's already up to date": compares every update row with the store (read only, in parallel batches)
 * and remembers which ones already hold the CSV's values, so they can be left out of the run and counted.
 */
export function useUpToDateScan() {
  const [state, setState] = useState<ScanState>(IDLE);
  const stopRef = useRef(false);

  const start = useCallback(async (entries: ScanEntry[], signature: string) => {
    const updates = entries.filter((entry) => entry.item.kind === "update");
    stopRef.current = false;
    const found = new Set<string>();
    let checked = 0;
    const reasonMap = new Map<string, ScanReasonSummary>();
    setState({ signature, upToDate: found, reasons: [], checked: 0, total: updates.length, running: true, error: null });

    const batches: ScanEntry[][] = [];
    for (let index = 0; index < updates.length; index += BATCH_SIZE) batches.push(updates.slice(index, index + BATCH_SIZE));

    let cursor = 0;
    let fatal: string | null = null;
    let busyRows = 0;
    const worker = async () => {
      while (!stopRef.current && fatal === null) {
        const batch = batches[cursor++];
        if (!batch) return;
        // A throttled batch waits and tries again (the wait grows each time) instead of ending the whole check.
        let results: BatchResult[] | null = null;
        for (let attempt = 0; attempt <= THROTTLE_RETRIES && results === null; attempt++) {
          try {
            results = await scanBatch(batch);
          } catch (err) {
            const message = err instanceof Error ? err.message : "The check failed.";
            if (!THROTTLE_PATTERN.test(message)) {
              fatal = message;
              return;
            }
            if (attempt < THROTTLE_RETRIES) await wait(2000 * 2 ** attempt);
          }
        }
        if (results) {
          for (const result of results) {
            if (result.upToDate) found.add(result.key);
            for (const reason of result.reasons) {
              const known = reasonMap.get(reason.label);
              if (known) known.count += 1;
              else reasonMap.set(reason.label, { label: reason.label, count: 1, sample: { sku: result.key, expected: reason.expected, actual: reason.actual } });
            }
          }
        } else {
          busyRows += batch.length;
        }
        checked += batch.length;
        setState((prev) => ({ ...prev, upToDate: new Set(found), reasons: [...reasonMap.values()].sort((a, b) => b.count - a.count), checked }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, batches.length) }, worker));
    const note = busyRows > 0 ? `${busyRows.toLocaleString()} products couldn't be checked because Shopify kept asking to slow down — they will simply be updated like normal. Run the check again to retry them.` : null;
    setState((prev) => ({ ...prev, running: false, error: fatal ?? note }));
  }, []);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const clear = useCallback(() => setState(IDLE), []);

  return { state, start, stop, clear };
}
