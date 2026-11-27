import "server-only";
import { mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { DriveError, openDriveStream, type DriveStream } from "./driveFetch";
import type { DriveJobSnapshot, DriveJobStatus } from "./driveJobTypes";
import { VISITOR_ID } from "./accessPolicy";
import { parseDriveLink } from "./googleDrive";

/**
 * Google Drive downloads that run ON THE SERVER: the server fetches the file from Drive over its own connection (several
 * pieces at once), saves it under `uploads/drive-downloads/<fileId>/`, and keeps going whether or not a browser is open.
 * Pieces already on disk survive a pause or a server restart, so a stopped download resumes instead of starting over.
 * Needs a server with a writable disk and a long-lived process (not a serverless host).
 */

const ROOT = path.join(process.cwd(), "uploads", "drive-downloads");
/** Each anonymous visitor (browser) has its own folder, so nobody can see, resume or delete anyone else's download. */
const ownerRoot = (owner: string): string => {
  if (!VISITOR_ID.test(owner)) throw new Error("Invalid visitor.");
  return path.join(ROOT, owner);
};
const PIECE_SIZE = 4 * 1024 ** 2;
const CONNECTIONS = 8;
const MAX_ATTEMPTS = 3;
/** Free space that must remain after the download, so the disk isn't filled to the brim. */
const DISK_MARGIN_BYTES = 256 * 1024 ** 2;
const MAX_BYTES = 50 * 1024 ** 3;
const SPEED_WINDOW_MS = 4000;
const SAMPLE_INTERVAL_MS = 500;
const FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;

interface JobMeta {
  fileId: string;
  url: string;
  name: string;
  /** 0 while unknown (a single-stream download whose size Drive didn't announce). */
  total: number;
  pieceSize: number;
  pieceCount: number;
  /** Indexes of pieces completely on disk. */
  done: number[];
  complete: boolean;
}

interface RunState {
  owner: string;
  fileId: string;
  url: string;
  controller: AbortController;
  running: boolean;
  status: DriveJobStatus;
  error: string | null;
  name: string | null;
  total: number | null;
  /** Bytes of fully written pieces. */
  doneBytes: number;
  /** Bytes written so far into pieces still in flight. */
  partial: Map<number, number>;
  sessionBytes: number;
  samples: { at: number; bytes: number }[];
  resumedBytes: number;
  updatedAt: number;
  finished: Promise<void>;
  metaWrites: Promise<void>;
}

const globalRegistry = globalThis as typeof globalThis & { __driveJobs?: Map<string, RunState> };
/** Kept on globalThis so every route module (and hot reloads in dev) share the same running jobs. */
const registry = (globalRegistry.__driveJobs ??= new Map<string, RunState>());

const dirOf = (owner: string, id: string) => path.join(ownerRoot(owner), id);
const partPath = (owner: string, id: string) => path.join(dirOf(owner, id), "data.part");
const finalPath = (owner: string, id: string) => path.join(dirOf(owner, id), "data.zip");
const metaPath = (owner: string, id: string) => path.join(dirOf(owner, id), "meta.json");
const keyOf = (owner: string, id: string) => `${owner}/${id}`;

const pieceBytes = (meta: Pick<JobMeta, "total" | "pieceSize">, index: number): number => Math.max(0, Math.min(meta.pieceSize, meta.total - index * meta.pieceSize));
const withZip = (name: string): string => (/\.zip$/i.test(name) ? name : `${name}.zip`);
const fatalIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
};

async function readMeta(owner: string, id: string): Promise<JobMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(owner, id), "utf-8")) as JobMeta;
  } catch {
    return null;
  }
}

/** Saved after every piece, one write at a time, via a temp file so a crash can't leave half a JSON file. */
function queueMetaWrite(state: RunState, meta: JobMeta): void {
  const snapshot = JSON.stringify(meta);
  state.metaWrites = state.metaWrites
    .then(async () => {
      const temp = `${metaPath(state.owner, meta.fileId)}.tmp`;
      await writeFile(temp, snapshot);
      await rename(temp, metaPath(state.owner, meta.fileId));
    })
    .catch(() => undefined);
}

function speedOf(state: RunState): number {
  const first = state.samples[0];
  const last = state.samples[state.samples.length - 1];
  if (!first || !last || last.at === first.at) return 0;
  return Math.max(0, ((last.bytes - first.bytes) / (last.at - first.at)) * 1000);
}

function snapshotOfRun(state: RunState): DriveJobSnapshot {
  const received = state.doneBytes + [...state.partial.values()].reduce((sum, n) => sum + n, 0);
  const bytesPerSecond = state.status === "downloading" ? speedOf(state) : 0;
  const remaining = state.total === null ? null : Math.max(0, state.total - received);
  return {
    id: state.fileId,
    url: state.url,
    name: state.name,
    total: state.total,
    received,
    bytesPerSecond,
    etaSeconds: remaining !== null && bytesPerSecond > 1024 ? remaining / bytesPerSecond : null,
    connections: state.status === "downloading" ? state.partial.size : 0,
    status: state.status,
    error: state.error,
    resumedBytes: state.resumedBytes,
    updatedAt: state.updatedAt,
  };
}

function snapshotOfMeta(meta: JobMeta): DriveJobSnapshot {
  const received = meta.complete ? meta.total : meta.done.reduce((sum, index) => sum + pieceBytes(meta, index), 0);
  return {
    id: meta.fileId,
    url: meta.url,
    name: meta.name,
    total: meta.total || null,
    received,
    bytesPerSecond: 0,
    etaSeconds: null,
    connections: 0,
    status: meta.complete ? "done" : "paused",
    error: null,
    resumedBytes: 0,
    updatedAt: Date.now(),
  };
}

/** Writes a piece's bytes into the file at its own offset, counting them as they land. Retries on trouble, never on a fatal Drive answer. */
async function writePiece(
  state: RunState,
  handle: FileHandle,
  meta: JobMeta,
  index: number,
  openStream: (signal: AbortSignal) => Promise<DriveStream>,
): Promise<void> {
  const signal = state.controller.signal;
  const start = index * meta.pieceSize;
  for (let attempt = 1; ; attempt++) {
    let written = 0;
    try {
      const stream = await openStream(signal);
      const reader = stream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await handle.write(value, 0, value.byteLength, start + written);
        written += value.byteLength;
        state.sessionBytes += value.byteLength;
        state.partial.set(index, written);
      }
      const expected = meta.total > 0 ? pieceBytes(meta, index) : written;
      if (written !== expected) throw new Error("A piece of the download arrived incomplete.");
      return;
    } catch (err) {
      state.sessionBytes -= written;
      state.partial.set(index, 0);
      if (signal.aborted || (err instanceof DriveError && err.fatal) || attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
}

async function ensureRoom(owner: string, total: number, alreadyOnDisk: number): Promise<void> {
  const stats = await statfs(ownerRoot(owner));
  const free = stats.bavail * stats.bsize;
  const needed = Math.max(0, total - alreadyOnDisk) + DISK_MARGIN_BYTES;
  if (free < needed) {
    const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
    throw new DriveError(`Not enough free disk space on the server: this file needs about ${gb(needed)} and only ${gb(free)} is free.`, true);
  }
}

async function run(state: RunState, existing: JobMeta | null): Promise<void> {
  const signal = state.controller.signal;
  const id = state.fileId;
  const owner = state.owner;
  const sampler = setInterval(() => {
    const now = Date.now();
    state.samples.push({ at: now, bytes: state.sessionBytes });
    while (state.samples.length > 2 && now - state.samples[0].at > SPEED_WINDOW_MS) state.samples.shift();
  }, SAMPLE_INTERVAL_MS);
  let handle: FileHandle | null = null;
  let probe: DriveStream | null = null;
  try {
    try {
      await mkdir(dirOf(owner, id), { recursive: true });
    } catch {
      throw new DriveError("This server can't save files (its disk is read-only), so downloads can't run here.", true);
    }

    let job: JobMeta;
    if (existing) {
      job = existing;
    } else {
      // The first piece doubles as the probe: it tells us the name, the size, and whether Drive honours ranges.
      probe = await openDriveStream(id, { start: 0, end: PIECE_SIZE - 1 }, signal);
      if (probe.total !== null && probe.total > MAX_BYTES) throw new DriveError("This file is far too large to download (over 50 GB).", true);
      const wholeFile = !probe.rangeHonoured || probe.total === null || probe.total <= PIECE_SIZE;
      const total = probe.total ?? 0;
      job = {
        fileId: id,
        url: state.url,
        name: withZip(probe.name ?? "drive-download.zip"),
        total,
        pieceSize: wholeFile ? total : PIECE_SIZE,
        pieceCount: wholeFile ? 1 : Math.ceil(total / PIECE_SIZE),
        done: [],
        complete: false,
      };
    }
    const doneSet = new Set(job.done);
    state.name = job.name;
    state.total = job.total || null;
    state.doneBytes = job.done.reduce((sum, index) => sum + pieceBytes(job, index), 0);
    state.resumedBytes = state.doneBytes;

    if (job.total > 0) await ensureRoom(state.owner, job.total, state.doneBytes);
    const file = await open(partPath(owner, id), existing ? "r+" : "w+");
    handle = file;
    if (job.total > 0) await file.truncate(job.total);
    state.status = "downloading";
    state.updatedAt = Date.now();

    const finishPiece = (index: number, size: number) => {
      state.partial.delete(index);
      state.doneBytes += size;
      doneSet.add(index);
      job = { ...job, done: [...doneSet].sort((a, b) => a - b) };
      queueMetaWrite(state, job);
    };

    /** Hands out the probe's stream once (for piece 0's first try), then opens fresh ones. */
    let probeUsed = false;
    const streamFor = (range: { start: number; end: number } | null, forPiece: number) => async (s: AbortSignal): Promise<DriveStream> => {
      if (probe && forPiece === 0 && !probeUsed) {
        probeUsed = true;
        return probe;
      }
      return openDriveStream(id, range, s);
    };

    const wholeFileMode = job.pieceCount === 1;
    if (wholeFileMode) {
      // One stream, written start to finish (a small file, or Drive wouldn't serve ranges).
      await writePiece(state, file, job, 0, streamFor(null, 0));
      const written = state.partial.get(0) ?? 0;
      if (job.total === 0) {
        job = { ...job, total: written, pieceSize: written };
        state.total = written;
      }
      finishPiece(0, written);
    } else {
      const todo: number[] = [];
      for (let index = 0; index < job.pieceCount; index++) if (!doneSet.has(index)) todo.push(index);
      const fixed = job;
      let next = 0;
      const worker = async () => {
        try {
          for (;;) {
            const index = todo[next++];
            if (index === undefined) return;
            fatalIfAborted(signal);
            const start = index * fixed.pieceSize;
            const end = start + pieceBytes(fixed, index) - 1;
            await writePiece(state, file, fixed, index, streamFor({ start, end }, index));
            finishPiece(index, pieceBytes(fixed, index));
          }
        } catch (err) {
          state.controller.abort(); // One piece that can't be fetched ends the whole job — stop the other connections too.
          throw err;
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONNECTIONS, todo.length) }, worker));
    }

    await file.close();
    handle = null;
    await state.metaWrites;
    await rename(partPath(owner, id), finalPath(owner, id));
    job = { ...job, complete: true };
    queueMetaWrite(state, job);
    await state.metaWrites;
    state.status = "done";
    state.error = null;
  } catch (err) {
    state.partial.clear();
    // The user pausing aborts the controller too; a failed piece aborts it as well, but then the error itself is what's thrown.
    if (err instanceof DOMException && err.name === "AbortError") {
      state.status = "paused";
    } else {
      state.status = "error";
      state.error = err instanceof Error ? err.message : "The download failed.";
    }
  } finally {
    clearInterval(sampler);
    await handle?.close().catch(() => undefined);
    await probe?.body.cancel().catch(() => undefined);
    state.running = false;
    state.updatedAt = Date.now();
  }
}

/** Starts a download (or picks up a stopped one, or reports a finished one). Returns straight away; the work continues on the server. */
export async function startDriveJob(url: string, owner: string): Promise<DriveJobSnapshot> {
  const link = parseDriveLink(url);
  if (link.kind !== "file") throw new DriveError("That doesn't look like a Google Drive file link.", true);
  const id = link.id;

  const running = registry.get(keyOf(owner, id));
  if (running?.running) return snapshotOfRun(running);

  const meta = await readMeta(owner, id);
  if (meta?.complete) return snapshotOfMeta(meta);

  const state: RunState = {
    owner,
    fileId: id,
    url,
    controller: new AbortController(),
    running: true,
    status: "starting",
    error: null,
    name: meta?.name ?? null,
    total: meta?.total || null,
    doneBytes: 0,
    partial: new Map(),
    sessionBytes: 0,
    samples: [{ at: Date.now(), bytes: 0 }],
    resumedBytes: 0,
    updatedAt: Date.now(),
    finished: Promise.resolve(),
    metaWrites: Promise.resolve(),
  };
  registry.set(keyOf(owner, id), state);
  state.finished = run(state, meta);
  return snapshotOfRun(state);
}

export async function getDriveJob(id: string, owner: string): Promise<DriveJobSnapshot | null> {
  if (!FILE_ID.test(id)) return null;
  const state = registry.get(keyOf(owner, id));
  if (state) return snapshotOfRun(state);
  const meta = await readMeta(owner, id);
  return meta ? snapshotOfMeta(meta) : null;
}

/** Every download the server knows about: the ones running now plus whatever is saved on disk (finished or stopped). */
export async function listDriveJobs(owner: string): Promise<DriveJobSnapshot[]> {
  let ids: string[] = [];
  try {
    ids = (await readdir(ownerRoot(owner))).filter((entry) => FILE_ID.test(entry));
  } catch {
    // No downloads folder yet.
  }
  const running = [...registry.values()].filter((state) => state.owner === owner).map((state) => state.fileId);
  const all = new Set([...ids, ...running]);
  const snapshots = await Promise.all([...all].map((id) => getDriveJob(id, owner)));
  return snapshots.filter((s): s is DriveJobSnapshot => s !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Stops a running download but keeps what's on disk, so it can be resumed. */
export async function pauseDriveJob(id: string, owner: string): Promise<DriveJobSnapshot | null> {
  const state = registry.get(keyOf(owner, id));
  if (state?.running) {
    state.controller.abort();
    await state.finished;
  }
  return getDriveJob(id, owner);
}

/** Stops the download (if running) and deletes everything saved for it. */
export async function discardDriveJob(id: string, owner: string): Promise<void> {
  if (!FILE_ID.test(id)) return;
  const state = registry.get(keyOf(owner, id));
  if (state?.running) {
    state.controller.abort();
    await state.finished;
  }
  registry.delete(keyOf(owner, id));
  await rm(dirOf(owner, id), { recursive: true, force: true });
}

/** The saved zip, when the download finished. */
export async function savedZip(owner: string, id: string): Promise<{ path: string; size: number; name: string } | null> {
  if (!FILE_ID.test(id)) return null;
  const meta = await readMeta(owner, id);
  if (!meta?.complete) return null;
  try {
    const info = await stat(finalPath(owner, id));
    return { path: finalPath(owner, id), size: info.size, name: meta.name };
  } catch {
    return null;
  }
}
