import "server-only";
import { mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { savedZip } from "./driveJobs";
import type { BgZipRef } from "./bgJobTypes";

/**
 * Zips that live on the server, so nothing depends on a browser staying open. A zip comes from Google Drive (downloaded by
 * the server, see driveJobs.ts) or from this computer (uploaded here in pieces, below). Either way the Background customiser
 * reads it from disk.
 */

const UPLOADS_ROOT = path.join(process.cwd(), "uploads", "bg-uploads");
const UPLOAD_ID = /^[a-z0-9]{12,40}$/;
const DISK_MARGIN_BYTES = 256 * 1024 ** 2;
const MAX_UPLOAD_BYTES = 50 * 1024 ** 3;

export interface UploadInfo {
  id: string;
  name: string;
  size: number;
  /** The file is sent as pieces of this size (the last one may be shorter); pieces may arrive in any order, several at once. */
  chunkSize: number;
  /** Indexes of the pieces already on disk — what a resumed upload skips. */
  have: number[];
  /** Bytes on disk so far. */
  received: number;
  complete: boolean;
  createdAt: number;
  /** Name + size + last-modified of the file on the visitor's computer, so the same file added again is recognised and not sent twice. */
  fingerprint: string;
  /** The anonymous visitor (browser) this upload belongs to; nobody else can see or use it. */
  owner: string;
}

/** Small enough for smooth progress and cheap retries, large enough to keep the request count down. */
export const UPLOAD_CHUNK_BYTES = 4 * 1024 ** 2;
/** A half-sent upload nobody came back to is cleared after this long. */
const STALE_PARTIAL_MS = 24 * 60 * 60 * 1000;

const dirOf = (id: string) => path.join(UPLOADS_ROOT, id);
const partPath = (id: string) => path.join(dirOf(id), "data.part");
const finalPath = (id: string) => path.join(dirOf(id), "data.zip");
const infoPath = (id: string) => path.join(dirOf(id), "info.json");

const safeName = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().slice(0, 200) || "upload.zip";

async function readInfo(id: string): Promise<UploadInfo | null> {
  if (!UPLOAD_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(infoPath(id), "utf-8")) as UploadInfo;
  } catch {
    return null;
  }
}

async function writeInfo(info: UploadInfo): Promise<void> {
  const temp = `${infoPath(info.id)}.tmp`;
  await writeFile(temp, JSON.stringify(info));
  await rename(temp, infoPath(info.id));
}

const chunkCountOf = (info: Pick<UploadInfo, "size" | "chunkSize">): number => Math.ceil(info.size / info.chunkSize);
const chunkBytes = (info: Pick<UploadInfo, "size" | "chunkSize">, index: number): number => Math.min(info.chunkSize, info.size - index * info.chunkSize);

/** Pieces of one upload are written one at a time, so two arriving together can't overwrite each other's bookkeeping. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const tail = (locks.get(id) ?? Promise.resolve()).then(work, work);
  const settled = tail.then(
    () => undefined,
    () => undefined,
  );
  locks.set(id, settled);
  void settled.then(() => {
    if (locks.get(id) === settled) locks.delete(id);
  });
  return tail;
}

/**
 * Starts an upload and reserves its space — or, when this visitor already has the same file (same name, size and
 * last-modified), hands that one back: finished means nothing needs sending at all, part-way means only the missing pieces do.
 */
export async function beginUpload(name: string, size: number, owner: string, fingerprint = ""): Promise<UploadInfo> {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("The file looks empty.");
  if (size > MAX_UPLOAD_BYTES) throw new Error("That file is too large to upload (over 50 GB).");

  const mine = await listUploads(owner);
  const cleanName = safeName(name);
  const known = fingerprint ? mine.find((upload) => upload.fingerprint === fingerprint && upload.size === size && upload.name === cleanName) : undefined;
  if (known) return known;
  // Half-sent uploads that were abandoned don't pile up on the disk.
  for (const upload of mine) {
    if (!upload.complete && Date.now() - upload.createdAt > STALE_PARTIAL_MS) await rm(dirOf(upload.id), { recursive: true, force: true });
  }

  const id = randomBytes(9).toString("hex");
  await mkdir(dirOf(id), { recursive: true });
  const stats = await statfs(UPLOADS_ROOT);
  const free = stats.bavail * stats.bsize;
  if (free < size + DISK_MARGIN_BYTES) {
    await rm(dirOf(id), { recursive: true, force: true });
    const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
    throw new Error(`Not enough free disk space on the server: this file needs about ${gb(size + DISK_MARGIN_BYTES)} and only ${gb(free)} is free.`);
  }
  const info: UploadInfo = { id, name: cleanName, size, chunkSize: UPLOAD_CHUNK_BYTES, have: [], received: 0, complete: false, createdAt: Date.now(), fingerprint, owner };
  await (await open(partPath(id), "w")).close();
  await writeInfo(info);
  return info;
}

/** Writes one piece at its own place in the file. Pieces can arrive in any order and several at once; sending one twice is harmless. */
export async function appendUploadChunk(id: string, offset: number, bytes: Uint8Array, owner: string): Promise<UploadInfo> {
  return withLock(id, async () => {
    const info = await readOwned(id, owner);
    if (!info) throw new Error("No such upload.");
    if (info.complete) return info;
    if (offset < 0 || offset >= info.size || offset % info.chunkSize !== 0) throw new Error("That piece doesn't start where a piece should.");
    const index = offset / info.chunkSize;
    if (bytes.byteLength !== chunkBytes(info, index)) throw new Error("That piece is the wrong size.");
    if (info.have.includes(index)) return info;

    const handle = await open(partPath(id), "r+");
    try {
      await handle.write(bytes, 0, bytes.byteLength, offset);
    } finally {
      await handle.close();
    }
    const next: UploadInfo = { ...info, have: [...info.have, index].sort((a, b) => a - b), received: info.received + bytes.byteLength };
    if (next.have.length === chunkCountOf(next)) {
      await rename(partPath(id), finalPath(id));
      next.complete = true;
    }
    await writeInfo(next);
    return next;
  });
}

/** The upload, only if it belongs to this visitor. */
async function readOwned(id: string, owner: string): Promise<UploadInfo | null> {
  const info = await readInfo(id);
  return info && info.owner === owner ? info : null;
}

export const getUpload = readOwned;

export async function listUploads(owner: string): Promise<UploadInfo[]> {
  let ids: string[] = [];
  try {
    ids = (await readdir(UPLOADS_ROOT)).filter((entry) => UPLOAD_ID.test(entry));
  } catch {
    // No uploads yet.
  }
  const infos = await Promise.all(ids.map(readInfo));
  return infos.filter((info): info is UploadInfo => info !== null && info.owner === owner).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteUpload(id: string, owner: string): Promise<void> {
  if (!UPLOAD_ID.test(id) || !(await readOwned(id, owner))) return;
  await rm(dirOf(id), { recursive: true, force: true });
}

/** The saved zip for a reference, or null when it isn't (or is no longer) on the server. */
export async function resolveZip(ref: BgZipRef, owner: string): Promise<{ path: string; size: number; name: string } | null> {
  if (ref.kind === "drive") return savedZip(owner, ref.id);
  const info = await readOwned(ref.id, owner);
  if (!info?.complete) return null;
  try {
    const stats = await stat(finalPath(ref.id));
    return { path: finalPath(ref.id), size: stats.size, name: info.name };
  } catch {
    return null;
  }
}
