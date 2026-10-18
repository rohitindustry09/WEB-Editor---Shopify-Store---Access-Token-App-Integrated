"use client";

import { useRef, useState } from "react";
import type { ApplyItem, ApplyResult } from "@/lib/skuApply";
import { DEFAULT_WORKERS, runApplyWorkers } from "../upload-products/applyWorkers";

export interface RunItem {
  /** The SKU — also what marks an item as "already done this session" so a second run can't create it twice. */
  key: string;
  item: ApplyItem;
}

export interface RunOutcome {
  key: string;
  action: "update" | "create";
  result: ApplyResult;
}

export function useBulkApplyRunner() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcomes, setOutcomes] = useState<RunOutcome[]>([]);
  const [cancelled, setCancelled] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const cancelRef = useRef(false);

  const run = async (items: RunItem[]) => {
    cancelRef.current = false;
    setCancelled(false);
    setStopping(false);
    setRunning(true);
    setOutcomes([]);
    setProgress({ done: 0, total: items.length });

    const collected: RunOutcome[] = [];
    await runApplyWorkers(items, {
      workers: DEFAULT_WORKERS,
      shouldStop: () => cancelRef.current,
      onOutcomes: (batch) => {
        collected.push(...batch);
        setProgress({ done: collected.length, total: items.length });
      },
    });

    setOutcomes(collected);
    setCancelled(cancelRef.current);
    setDoneKeys((prev) => {
      const next = new Set(prev);
      for (const outcome of collected) if (outcome.result.ok) next.add(outcome.key);
      return next;
    });
    setRunning(false);
  };

  const cancel = () => {
    cancelRef.current = true;
    setStopping(true);
  };

  const dismiss = () => setOutcomes([]);

  return { running, stopping, progress, outcomes, cancelled, doneKeys, run, cancel, dismiss };
}
