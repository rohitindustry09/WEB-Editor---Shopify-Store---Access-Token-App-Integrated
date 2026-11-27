import "server-only";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { renderItem, outputPathFor, type BgItemConfig } from "./bgItem";
import type { BgJobFailure, BgJobSnapshot, BgJobSpec, BgJobStatus, StoredBackground } from "./bgJobTypes";
import { ASSET_ID, JOB_ID } from "./bgJobTypes";
import type { BackgroundConfig, LogoOverlay } from "./backgroundComposite";
import { installServerCanvas } from "./serverCanvas";
import { loadSkuMediaZip, readFolderImages, readZipImage } from "./skuMediaZip";
import { resolveZip } from "./serverZips";

/**
 * Background customiser runs that live ON THE SERVER. A run is saved as files under `uploads/bg-jobs/<id>/`: its settings
 * (spec.json), its progress (state.json + a log of finished images) and its results (out/<SKU>/<file>). The server keeps
 * working whether or not a browser is open, picks up where it left off after a restart, and keeps the results until the
 * run is deleted. Needs a server with a writable disk and a long-lived process (not a serverless host).
 */

const ROOT = path.join(process.cwd(), "uploads", "bg-jobs");
const CONCURRENCY = 2;
const MAX_ITEMS = 200_000;
const MAX_FAILURES_KEPT = 200;
/** The list view carries only a few failures per run (the page shows eight); it is polled every second while anything runs. */
const FAILURES_IN_LIST = 20;
const STATE_WRITE_MS = 1000;
const SPEED_WINDOW_MS = 8000;

const dirOf = (id: string) => path.join(ROOT, id);
const specPath = (id: string) => path.join(dirOf(id), "spec.json");
const statePath = (id: string) => path.join(dirOf(id), "state.json");
const donePath = (id: string) => path.join(dirOf(id), "done.log");
const copiedPath = (id: string) => path.join(dirOf(id), "copied.log");
const assetPath = (id: string, assetId: string) => path.join(dirOf(id), "assets", assetId);
export const bgJobOutputDir = (id: string) => path.join(dirOf(id), "out");

interface PersistedState {
  /** The anonymous visitor (browser) this run belongs to; nobody else can see, cancel, download or delete it. */
  owner: string;
  status: BgJobStatus;
  total: number;
  copyTotal: number;
  failed: number;
  failures: BgJobFailure[];
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

interface Run {
  id: string;
  spec: BgJobSpec;
  state: PersistedState;
  done: Set<string>;
  copied: Set<string>;
  current: string | null;
  cancelled: boolean;
  running: boolean;
  samples: { at: number; done: number }[];
  finished: Promise<void>;
  writeTimer: ReturnType<typeof setTimeout> | null;
}

const globalState = globalThis as typeof globalThis & { __bgJobs?: { runs: Map<string, Run>; queue: string[]; pumping: boolean } };
/** On globalThis so every route module (and hot reloads in dev) share the same runs. */
const registry = (globalState.__bgJobs ??= { runs: new Map<string, Run>(), queue: [], pumping: false });

const cleanSegment = (value: string): string => {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "_" : cleaned;
};

/** Where an image's result goes inside `out/`: its SKU folder, then its file name — the same layout the zip export always had. */
function outputLocation(folder: string, filename: string): { dir: string; file: string } {
  return { dir: cleanSegment(folder), file: cleanSegment(filename) };
}

async function readLines(file: string): Promise<Set<string>> {
  try {
    return new Set((await readFile(file, "utf-8")).split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

async function writeState(run: Run): Promise<void> {
  const temp = `${statePath(run.id)}.tmp`;
  await writeFile(temp, JSON.stringify(run.state));
  await rename(temp, statePath(run.id));
}

/** State is written at most once a second while running, so thousands of images don't mean thousands of writes. */
function scheduleStateWrite(run: Run): void {
  if (run.writeTimer) return;
  run.writeTimer = setTimeout(() => {
    run.writeTimer = null;
    void writeState(run).catch(() => undefined);
  }, STATE_WRITE_MS);
}

function snapshotOf(run: Run): BgJobSnapshot {
  const now = Date.now();
  const recent = run.samples.filter((sample) => now - sample.at <= SPEED_WINDOW_MS);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const itemsPerSecond = first && last && last.at > first.at ? ((last.done - first.done) / (last.at - first.at)) * 1000 : 0;
  const total = run.state.total + run.state.copyTotal;
  const remaining = Math.max(0, total - run.done.size - run.copied.size - run.state.failed);
  return {
    id: run.id,
    name: run.spec.name,
    status: run.state.status,
    total: run.state.total,
    done: run.done.size,
    failed: run.state.failed,
    copied: run.copied.size,
    copyTotal: run.state.copyTotal,
    current: run.state.status === "running" ? run.current : null,
    error: run.state.error,
    failures: run.state.failures,
    createdAt: run.state.createdAt,
    startedAt: run.state.startedAt,
    finishedAt: run.state.finishedAt,
    itemsPerSecond: run.state.status === "running" ? Math.max(0, itemsPerSecond) : 0,
    etaSeconds: run.state.status === "running" && itemsPerSecond > 0.01 ? remaining / itemsPerSecond : null,
  };
}

/** Reads a stored background's picture (if it has one) into the form `compositeBackground` takes. */
async function hydrateBackground(id: string, stored: StoredBackground): Promise<BackgroundConfig> {
  if (!("assetId" in stored)) return stored;
  const { assetId, ...rest } = stored;
  return { ...rest, image: new Blob([await readFile(assetPath(id, assetId))]) };
}

async function buildConfig(run: Run): Promise<BgItemConfig> {
  const { spec, id } = run;
  let logo: LogoOverlay | undefined;
  if (spec.logo) {
    const { assetId, ...rest } = spec.logo;
    logo = { ...rest, image: new Blob([await readFile(assetPath(id, assetId))]) };
  }
  return {
    primaryConfig: await hydrateBackground(id, spec.primary),
    secondaryConfig: await hydrateBackground(id, spec.secondary),
    foregroundZoom: spec.foregroundZoom,
    logo,
    canvasShape: spec.canvasShape,
    textOverlay: spec.textOverlay,
    conversion: spec.conversion,
  };
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function writeOutput(id: string, folder: string, filename: string, blob: Blob): Promise<void> {
  const { dir, file } = outputLocation(folder, filename);
  const target = path.join(bgJobOutputDir(id), dir);
  await mkdir(target, { recursive: true });
  const finalFile = path.join(target, file);
  const temp = `${finalFile}.tmp`;
  await writeFile(temp, new Uint8Array(await blob.arrayBuffer()));
  await rename(temp, finalFile);
}

async function runJob(run: Run): Promise<void> {
  run.running = true;
  run.state.status = "running";
  run.state.startedAt ??= Date.now();
  run.state.error = null;
  await writeState(run).catch(() => undefined);
  try {
    installServerCanvas();
    const zipInfo = await resolveZip(run.spec.source, run.state.owner);
    if (!zipInfo) throw new Error("The zip this run reads from is no longer on the server.");
    const file = new File([await openAsBlob(zipInfo.path)], zipInfo.name, { type: "application/zip" });
    const { zip, folders } = await loadSkuMediaZip(file);
    const config = await buildConfig(run);

    const folderOf = new Map<string, string>();
    for (const folder of folders) for (const filePath of folder.filePaths) folderOf.set(filePath, folder.sku);

    // --- Images this run changes ---
    const todo = run.spec.items.filter((item) => !run.done.has(item.path));
    let next = 0;
    const worker = async () => {
      for (;;) {
        if (run.cancelled) return;
        const item = todo[next++];
        if (!item) return;
        run.current = item.path;
        try {
          const source = await readZipImage(zip, item.path);
          if (!source) throw new Error("Couldn't read this file from the zip.");
          const result = await renderItem({ path: item.path, mode: item.mode, folder: item.folder, position: item.position, source }, config);
          const base = item.path.split("/").pop() ?? item.path;
          await writeOutput(run.id, item.folder || folderOf.get(item.path) || "", result.outputFilename ?? outputPathFor(base), result.blob);
          run.done.add(item.path);
          await appendFile(donePath(run.id), `${item.path}\n`);
          run.samples.push({ at: Date.now(), done: run.done.size + run.copied.size });
        } catch (err) {
          run.state.failed += 1;
          if (run.state.failures.length < MAX_FAILURES_KEPT) {
            run.state.failures.push({ path: item.path, message: err instanceof Error ? err.message : "Couldn't process this image." });
          }
        }
        scheduleStateWrite(run);
        await yieldToEventLoop();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, todo.length)) }, worker));

    // --- Every other image goes across unchanged, so the download is a complete copy of the zip ---
    if (!run.cancelled) {
      const changed = new Set(run.spec.items.map((item) => item.path));
      const untouched = [...folderOf.keys()].filter((p) => !changed.has(p));
      run.state.copyTotal = untouched.length;
      const pending = untouched.filter((p) => !run.copied.has(p));
      let nextCopy = 0;
      const copier = async () => {
        for (;;) {
          if (run.cancelled) return;
          const filePath = pending[nextCopy++];
          if (!filePath) return;
          run.current = filePath;
          try {
            const [image] = await readFolderImages(zip, [filePath]);
            if (!image) throw new Error("Couldn't read this file from the zip.");
            await writeOutput(run.id, folderOf.get(filePath) ?? "", image.filename, image.blob);
            run.copied.add(filePath);
            await appendFile(copiedPath(run.id), `${filePath}\n`);
            run.samples.push({ at: Date.now(), done: run.done.size + run.copied.size });
          } catch (err) {
            run.state.failed += 1;
            if (run.state.failures.length < MAX_FAILURES_KEPT) {
              run.state.failures.push({ path: filePath, message: err instanceof Error ? err.message : "Couldn't copy this image." });
            }
          }
          scheduleStateWrite(run);
          await yieldToEventLoop();
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pending.length)) }, copier));
    }
    run.state.status = run.cancelled ? "cancelled" : "done";
  } catch (err) {
    run.state.status = run.cancelled ? "cancelled" : "error";
    run.state.error = run.cancelled ? null : err instanceof Error ? err.message : "The run failed.";
  } finally {
    if (run.writeTimer) clearTimeout(run.writeTimer);
    run.writeTimer = null;
    run.current = null;
    run.running = false;
    run.state.finishedAt = Date.now();
    await writeState(run).catch(() => undefined);
  }
}

/** One run at a time (they are CPU-heavy); the rest wait their turn in the order they were started. */
async function pump(): Promise<void> {
  if (registry.pumping) return;
  registry.pumping = true;
  try {
    for (let id = registry.queue.shift(); id !== undefined; id = registry.queue.shift()) {
      const run = registry.runs.get(id);
      if (run && !run.cancelled) {
        run.finished = runJob(run);
        await run.finished;
      }
    }
  } finally {
    registry.pumping = false;
  }
}

function enqueue(run: Run): void {
  registry.runs.set(run.id, run);
  registry.queue.push(run.id);
  void pump();
}

async function loadRun(id: string): Promise<Run | null> {
  if (!JOB_ID.test(id)) return null;
  try {
    const spec = JSON.parse(await readFile(specPath(id), "utf-8")) as BgJobSpec;
    const state = JSON.parse(await readFile(statePath(id), "utf-8")) as PersistedState;
    return {
      id,
      spec,
      state,
      done: await readLines(donePath(id)),
      copied: await readLines(copiedPath(id)),
      current: null,
      cancelled: false,
      running: false,
      samples: [],
      finished: Promise.resolve(),
      writeTimer: null,
    };
  } catch {
    return null;
  }
}

/** Checks a spec from the browser before anything is written: sizes, references and file names. Returns a message when it isn't acceptable. */
export async function validateSpec(spec: BgJobSpec, assetIds: Set<string>, owner: string): Promise<string | null> {
  if (spec.version !== 1) return "Unknown run format.";
  if (!Array.isArray(spec.items) || spec.items.length > MAX_ITEMS) return `A run can change up to ${MAX_ITEMS.toLocaleString()} images.`;
  if (typeof spec.name !== "string" || spec.name.trim() === "") return "The run needs a name.";
  if (!(await resolveZip(spec.source, owner))) return "That zip isn't on the server (yet). Wait for its upload or download to finish.";
  const needed = [spec.primary, spec.secondary].flatMap((b) => ("assetId" in b ? [b.assetId] : []));
  if (spec.logo) needed.push(spec.logo.assetId);
  for (const assetId of needed) {
    if (!ASSET_ID.test(assetId) || !assetIds.has(assetId)) return "A picture this run needs (background image or logo) wasn't sent.";
  }
  for (const item of spec.items) {
    if (typeof item.path !== "string" || item.path === "" || !["primary", "secondary", "zoom-only", "convert-only"].includes(item.mode)) {
      return "The list of images to change is malformed.";
    }
  }
  return null;
}

/** Saves a new run and puts it in the queue. The server starts on it straight away. */
export async function createBgJob(spec: BgJobSpec, assets: Map<string, Uint8Array>, owner: string): Promise<BgJobSnapshot> {
  const id = randomUUID();
  await mkdir(path.join(dirOf(id), "assets"), { recursive: true });
  for (const [assetId, bytes] of assets) {
    if (ASSET_ID.test(assetId)) await writeFile(assetPath(id, assetId), bytes);
  }
  const state: PersistedState = {
    owner,
    status: "queued",
    total: spec.items.length,
    copyTotal: 0,
    failed: 0,
    failures: [],
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  await writeFile(specPath(id), JSON.stringify(spec));
  await writeFile(statePath(id), JSON.stringify(state));
  const run: Run = { id, spec, state, done: new Set(), copied: new Set(), current: null, cancelled: false, running: false, samples: [], finished: Promise.resolve(), writeTimer: null };
  enqueue(run);
  return snapshotOf(run);
}

export async function getBgJob(id: string, owner: string): Promise<BgJobSnapshot | null> {
  const live = registry.runs.get(id);
  if (live) return live.state.owner === owner ? snapshotOf(live) : null;
  const run = await loadRun(id);
  if (!run || run.state.owner !== owner) return null;
  // A finished run never changes again, so keep it in memory — otherwise every poll re-reads its (possibly huge) files from disk.
  if (run.state.status === "done" || run.state.status === "cancelled" || run.state.status === "error") registry.runs.set(id, run);
  return snapshotOf(run);
}

export async function listBgJobs(owner: string): Promise<BgJobSnapshot[]> {
  let ids: string[] = [];
  try {
    ids = (await readdir(ROOT)).filter((entry) => JOB_ID.test(entry));
  } catch {
    // No runs yet.
  }
  const snapshots = await Promise.all(ids.map((id) => getBgJob(id, owner)));
  return snapshots
    .filter((s): s is BgJobSnapshot => s !== null)
    .map((s) => ({ ...s, failures: s.failures.slice(0, FAILURES_IN_LIST) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Stops a run. What it finished stays on disk and can still be downloaded. */
export async function cancelBgJob(id: string, owner: string): Promise<BgJobSnapshot | null> {
  if (!(await getBgJob(id, owner))) return null;
  const live = registry.runs.get(id);
  if (live) {
    live.cancelled = true;
    if (live.running) await live.finished;
    else if (live.state.status === "queued") {
      live.state.status = "cancelled";
      live.state.finishedAt = Date.now();
      await writeState(live).catch(() => undefined);
    }
    return snapshotOf(live);
  }
  return getBgJob(id, owner);
}

/** Stops the run (if running) and deletes everything saved for it, including its results. */
export async function deleteBgJob(id: string, owner: string): Promise<void> {
  if (!JOB_ID.test(id) || !(await getBgJob(id, owner))) return;
  await cancelBgJob(id, owner);
  registry.runs.delete(id);
  await rm(dirOf(id), { recursive: true, force: true });
}

/** Where a run's results are, and what to call the downloaded zip. */
export async function bgJobDownload(id: string, owner: string): Promise<{ dir: string; name: string; hasFiles: boolean } | null> {
  const snapshot = await getBgJob(id, owner);
  if (!snapshot) return null;
  const hasFiles = await stat(bgJobOutputDir(id)).then((s) => s.isDirectory()).catch(() => false);
  return { dir: bgJobOutputDir(id), name: snapshot.name, hasFiles };
}

/**
 * Called when the server starts: any run that was still going (or waiting) when it last stopped carries on from its saved
 * progress, with no browser involved.
 */
export async function resumeBgJobs(): Promise<number> {
  let ids: string[] = [];
  try {
    ids = (await readdir(ROOT)).filter((entry) => JOB_ID.test(entry));
  } catch {
    return 0;
  }
  let resumed = 0;
  for (const id of ids.sort()) {
    if (registry.runs.has(id)) continue;
    const run = await loadRun(id);
    if (!run || (run.state.status !== "running" && run.state.status !== "queued")) continue;
    run.state.status = "queued";
    enqueue(run);
    resumed += 1;
  }
  return resumed;
}
