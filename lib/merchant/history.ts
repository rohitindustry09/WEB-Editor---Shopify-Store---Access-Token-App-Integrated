import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HistoryEntry, HistoryRunSummary } from "./types";

/**
 * The change history behind "undo": every run a Merchant Tool makes is kept with the values it replaced.
 * Stored as JSON at `<project>/data/merchant-history.json` (outside `.next/`, so rebuilds keep it), written
 * write-then-rename. Only the newest runs are kept so the file can't grow without bound.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "merchant-history.json");
const TEMP_FILE = `${FILE}.tmp`;
const MAX_RUNS = 40;

interface StoredRun {
  id: string;
  shop: string;
  tool: string;
  label: string;
  createdAt: string;
  revertedAt: string | null;
  entries: HistoryEntry[];
}

interface HistoryFile {
  version: 1;
  runs: StoredRun[];
}

async function read(): Promise<HistoryFile> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Partial<HistoryFile>;
    if (Array.isArray(parsed.runs)) return { version: 1, runs: parsed.runs };
  } catch {
    // missing or unreadable — start empty
  }
  return { version: 1, runs: [] };
}

async function write(data: HistoryFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TEMP_FILE, JSON.stringify(data), "utf8");
  await rename(TEMP_FILE, FILE);
}

// Read-modify-write cycles run one at a time: parallel apply batches append to the same run.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

const RUN_ID = /^[A-Za-z0-9_-]{6,64}$/;
export const isValidRunId = (value: unknown): value is string => typeof value === "string" && RUN_ID.test(value);

/** Adds entries to a run, creating the run on its first batch. */
export function appendEntries(shop: string, meta: { runId: string; tool: string; label: string }, entries: HistoryEntry[]): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  return locked(async () => {
    const data = await read();
    const existing = data.runs.find((run) => run.id === meta.runId && run.shop === shop);
    if (existing) {
      existing.entries.push(...entries);
    } else {
      data.runs.push({ id: meta.runId, shop, tool: meta.tool.slice(0, 60), label: meta.label.slice(0, 160), createdAt: new Date().toISOString(), revertedAt: null, entries: [...entries] });
    }
    await write({ version: 1, runs: data.runs.slice(-MAX_RUNS) });
  });
}

/** This store's runs, newest first. */
export async function listRuns(shop: string): Promise<HistoryRunSummary[]> {
  const data = await read();
  return data.runs
    .filter((run) => run.shop === shop)
    .map((run) => ({ id: run.id, tool: run.tool, label: run.label, createdAt: run.createdAt, entryCount: run.entries.length, revertedAt: run.revertedAt }))
    .reverse();
}

export async function getRunEntries(shop: string, runId: string): Promise<HistoryEntry[] | null> {
  const run = (await read()).runs.find((candidate) => candidate.id === runId && candidate.shop === shop);
  return run ? run.entries : null;
}

export function markReverted(shop: string, runId: string): Promise<void> {
  return locked(async () => {
    const data = await read();
    const run = data.runs.find((candidate) => candidate.id === runId && candidate.shop === shop);
    if (!run) return;
    run.revertedAt = new Date().toISOString();
    await write(data);
  });
}

export function deleteRun(shop: string, runId: string): Promise<void> {
  return locked(async () => {
    const data = await read();
    await write({ version: 1, runs: data.runs.filter((run) => !(run.id === runId && run.shop === shop)) });
  });
}
