import "server-only";
import { persistJob, loadPersistedJobs, readPersistedJob } from "./jobPersistence";
import type { ScrapeJob, ScrapeJobOptions } from "./types";

/**
 * In-memory job registry, backed by JSON files on disk (`jobPersistence.ts`)
 * for anything that finishes — this app has no database anywhere (every
 * other personal tool processes entirely client-side), so this reaches for
 * plain files instead of standing one up. The split: the in-memory `Map`
 * is what every request actually reads/writes against (fast, and holds
 * in-progress jobs disk never sees mid-run), while disk is what makes a
 * finished job survive past this process's lifetime — a dev-server
 * restart, a `next build` + `next start` cycle, anything that starts a
 * fresh Node process with an empty module scope. Confirmed as a real gap
 * before this existed: "Recent jobs" only ever showed the single job that
 * happened to survive the CURRENT process, losing everything from before
 * the last restart even though nothing about those jobs was ever wrong.
 *
 * Stashed on `globalThis` rather than a plain module-scope `const` because
 * `next dev`'s Turbopack module graph re-evaluates route/lib modules on
 * every relevant file save (Fast Refresh/HMR) — a plain module-level `Map`
 * would silently reset to empty on the next edit mid-scrape, losing an
 * in-flight job for no reason a user would expect. `globalThis` survives
 * that re-evaluation since it's the one thing HMR doesn't reset; this is
 * the same pattern Next.js's own docs recommend for a dev-mode singleton
 * (e.g. reusing a single Prisma client across hot reloads). It does NOT
 * survive an actual process restart, which is exactly the gap disk fills.
 */
const globalForJobs = globalThis as unknown as { __storeScraperJobs?: Map<string, ScrapeJob>; __storeScraperJobsLoadedFromDisk?: boolean };
const jobs = globalForJobs.__storeScraperJobs ?? new Map<string, ScrapeJob>();
if (process.env.NODE_ENV !== "production") {
  globalForJobs.__storeScraperJobs = jobs;
}

const MAX_FINISHED_JOBS_IN_MEMORY = 30;

function isFinished(job: ScrapeJob): boolean {
  return job.status === "done" || job.status === "error" || job.status === "cancelled";
}

/**
 * A job loaded from disk with a non-terminal status (`queued`,
 * `discovering`, `scraping`) was mid-run when the PREVIOUS process ended —
 * there is no way for a freshly started process to have a live
 * `runJob`/`runPipeline` execution for it (that was a specific async call
 * stack in the old process, gone the moment it exited). Left as-is, a job
 * like that would sit frozen showing "Scraping…" forever: nothing will
 * ever call `updateJob` with a terminal status for it again, and the
 * Cancel button can't do anything either (there's nothing left running to
 * cancel). This finalizes it immediately instead — as `"cancelled"`,
 * keeping whatever was scraped before the interruption — which is exactly
 * the "just save where we left off" behavior a restart should have, not a
 * job stuck in limbo that looks like it's still working.
 */
function reconcileInterruptedJob(job: ScrapeJob): ScrapeJob {
  if (isFinished(job)) return job;
  return {
    ...job,
    status: "cancelled",
    statusMessage: `Interrupted by a server restart — ${job.products.length} scraped, ${job.failures.length} failed before stopping.`,
    finishedAt: new Date().toISOString(),
  };
}

// Seeds the in-memory map from disk exactly once per process — guarded so
// an HMR re-evaluation of this module (which reuses the same `globalThis`
// map) doesn't re-read every file on disk again for no reason. Only jobs
// loaded from disk go through `reconcileInterruptedJob` — a job already
// alive in the in-memory map from an HMR-surviving in-progress run must
// NOT be touched here, or a hot reload would falsely "cancel" a job that's
// actually still running fine in this same process.
if (!globalForJobs.__storeScraperJobsLoadedFromDisk) {
  for (const job of loadPersistedJobs()) {
    const reconciled = reconcileInterruptedJob(job);
    jobs.set(reconciled.id, reconciled);
    if (reconciled !== job) void persistJob(reconciled);
  }
  globalForJobs.__storeScraperJobsLoadedFromDisk = true;
}

function pruneFinishedJobs(): void {
  const finished = Array.from(jobs.values()).filter(isFinished);
  if (finished.length <= MAX_FINISHED_JOBS_IN_MEMORY) return;
  finished.sort((a, b) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""));
  // Only evicts from the in-memory Map — the disk copy (already written by
  // `updateJob` when the job finished) stays put, so `getJob` can still
  // rehydrate it on demand later; this just bounds RAM for a
  // long-running process, not job history.
  for (const job of finished.slice(0, finished.length - MAX_FINISHED_JOBS_IN_MEMORY)) {
    jobs.delete(job.id);
  }
}

export function createJob(job: ScrapeJob): void {
  jobs.set(job.id, job);
  pruneFinishedJobs();
}

/** Falls back to disk when a job has aged out of the in-memory cache (see `pruneFinishedJobs`) — e.g. re-downloading an export for an older job after the process has handled a lot of other jobs since. */
export async function getJob(id: string): Promise<ScrapeJob | null> {
  const inMemory = jobs.get(id);
  if (inMemory) return inMemory;
  const fromDisk = await readPersistedJob(id);
  if (fromDisk) jobs.set(id, fromDisk);
  return fromDisk;
}

export function updateJob(id: string, patch: Partial<ScrapeJob>): void {
  const existing = jobs.get(id);
  if (!existing) return;
  const next = { ...existing, ...patch };
  jobs.set(id, next);
  if (isFinished(next)) void persistJob(next);
}

/**
 * Writes whatever's currently in memory for this job to disk RIGHT NOW,
 * regardless of whether it's finished — `updateJob` above only persists on
 * completion, which means an in-progress job (still discovering/scraping)
 * isn't saved anywhere disk-durable yet. `jobRunner.ts` calls this on a
 * timer while a job runs, so a server restart mid-scrape loses at most a
 * few seconds of progress instead of the whole thing.
 */
export function persistJobSnapshot(id: string): void {
  const existing = jobs.get(id);
  if (existing) void persistJob(existing);
}

export function appendProduct(id: string, product: ScrapeJob["products"][number]): void {
  const existing = jobs.get(id);
  if (!existing) return;
  existing.products.push(product);
  existing.scrapedCount = existing.products.length;
}

export function appendFailure(id: string, failure: ScrapeJob["failures"][number]): void {
  const existing = jobs.get(id);
  if (!existing) return;
  existing.failures.push(failure);
  existing.failedCount = existing.failures.length;
}

export function listJobs(): ScrapeJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Finds a finished, FAILURE-FREE job for the same platform+scope+URL to
 * return outright instead of starting a new one. Deliberately requires
 * `failedCount === 0` — a prior job that had failures should never be
 * handed back as-is (that would silently hand the user those same
 * failures again with no chance to retry them); instead, a fresh job
 * starts and leans on `productCache.ts`'s per-product cache to skip only
 * the products that actually succeeded last time.
 */
export function findCachedJob(options: Pick<ScrapeJobOptions, "platform" | "scope" | "inputUrl">): ScrapeJob | null {
  const target = normalizeUrl(options.inputUrl);
  const candidates = Array.from(jobs.values()).filter(
    (job) =>
      job.status === "done" &&
      job.failedCount === 0 &&
      job.options.platform === options.platform &&
      job.options.scope === options.scope &&
      normalizeUrl(job.options.inputUrl) === target,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
  return candidates[0];
}
