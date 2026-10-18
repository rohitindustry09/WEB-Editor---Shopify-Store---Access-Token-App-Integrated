import "server-only";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ScrapeJob } from "./types";

/**
 * On-disk backing store for finished jobs — one JSON file per job under
 * `<project>/data/store-scraper-jobs/`, the same `data/` directory (and
 * write-then-rename safety pattern) `lib/auth/accounts.ts` already uses
 * for store accounts. Deliberately outside `.next/`, so a `next build` (or
 * a plain dev-server restart) never wipes it.
 *
 * The in-memory registry (`store.ts`) is `globalThis`-backed to survive
 * `next dev`'s Fast Refresh, but that only helps within a single running
 * process — an actual restart, or a build/start cycle, starts a fresh
 * process with an empty module scope regardless. Writing finished jobs
 * here and reading them back at startup is what makes job history survive
 * THAT. Confirmed as a real gap before this existed: "Recent jobs" only
 * ever showed whatever happened to survive the CURRENT process.
 */
const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_DIR = path.join(DATA_DIR, "store-scraper-jobs");

function jobFilePath(jobId: string): string {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

/** Writes a job's full current state to disk (write-then-rename, so a crash mid-write can't leave a truncated file behind). Best-effort — a failed disk write shouldn't take down the job itself; the in-memory copy stays authoritative for the rest of this process's life either way. */
export async function persistJob(job: ScrapeJob): Promise<void> {
  try {
    await mkdir(JOBS_DIR, { recursive: true });
    const finalPath = jobFilePath(job.id);
    const tempPath = `${finalPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(job), "utf8");
    await rename(tempPath, finalPath);
  } catch {
    // best-effort, see doc comment
  }
}

/**
 * Reads every persisted job back, skipping any file that fails to parse
 * (partial write, corruption) rather than failing the whole load. Used
 * once at process startup to seed the in-memory registry — synchronous
 * because that seeding has to finish before any request handler can run,
 * and this only ever happens once per process.
 */
export function loadPersistedJobs(): ScrapeJob[] {
  if (!existsSync(JOBS_DIR)) return [];
  const jobs: ScrapeJob[] = [];
  for (const file of readdirSync(JOBS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      jobs.push(JSON.parse(readFileSync(path.join(JOBS_DIR, file), "utf8")) as ScrapeJob);
    } catch {
      // skip corrupt/partial file
    }
  }
  return jobs;
}

/** Reads a single job by id straight from disk — the fallback `store.ts` uses when a job has aged out of the in-memory cache but the client still asks for it (e.g. re-downloading an old export). */
export async function readPersistedJob(jobId: string): Promise<ScrapeJob | null> {
  try {
    return JSON.parse(await readFile(jobFilePath(jobId), "utf8")) as ScrapeJob;
  } catch {
    return null;
  }
}

export async function deletePersistedJob(jobId: string): Promise<void> {
  try {
    await unlink(jobFilePath(jobId));
  } catch {
    // best-effort — already gone, or never existed
  }
}
