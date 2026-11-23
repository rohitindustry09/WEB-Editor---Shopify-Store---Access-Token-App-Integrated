import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * What the Metaobject & metafield builder remembers: the files you uploaded (so you can download or re-attach
 * them) and a log of what each run created (so it can be reverted). Kept on this server's disk under
 * `<project>/data/metaobject-builder/` — outside `.next/`, so rebuilds don't wipe it — and written
 * write-then-rename. On a host with a read-only disk (such as Vercel) nothing can be saved; callers get the error.
 */

const DIR = path.join(process.cwd(), "data", "metaobject-builder");
const FILES_DIR = path.join(DIR, "files");
const INDEX = path.join(DIR, "index.json");
const TEMP_INDEX = `${INDEX}.tmp`;

export const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 40;
const MAX_ACTIVITY = 60;

export interface SavedFile {
  id: string;
  name: string;
  /** "csv" for a spreadsheet of fields, "list" for a pasted `Name | key | Type` list. */
  kind: "csv" | "list";
  size: number;
  hash: string;
  createdAt: string;
}

/** The builder page's settings when a run happened, so "Run again" can put them back. */
export interface ActivitySettings {
  mode: "multi" | "single";
  source: "csv" | "paste";
  singleName: string;
  handle: string;
  makeMetafield: boolean;
  metafieldKey: string;
  metafieldName: string;
  ownerType: "PRODUCT" | "COLLECTION";
  storefront: boolean;
}

export interface ActivityObject {
  type: string;
  name: string;
  /** Shopify's id for the definition. */
  id: string;
  /** False when the definition already existed and was only reused — a revert never deletes those. */
  created: boolean;
  fieldCount: number;
}

export interface ActivityMetafield {
  namespace: string;
  key: string;
  ownerType: "PRODUCT" | "COLLECTION";
  /** Shopify's id for the metafield definition; null when it already existed. */
  id: string | null;
  created: boolean;
}

export interface ActivityEntry {
  id: string;
  shop: string;
  createdAt: string;
  label: string;
  settings: ActivitySettings;
  fileId: string | null;
  objects: ActivityObject[];
  metafields: ActivityMetafield[];
  revertedAt: string | null;
}

interface IndexFile {
  version: 1;
  files: (SavedFile & { shop: string })[];
  activity: ActivityEntry[];
}

async function readIndex(): Promise<IndexFile> {
  try {
    const parsed = JSON.parse(await readFile(INDEX, "utf8")) as Partial<IndexFile>;
    return { version: 1, files: Array.isArray(parsed.files) ? parsed.files : [], activity: Array.isArray(parsed.activity) ? parsed.activity : [] };
  } catch {
    return { version: 1, files: [], activity: [] };
  }
}

async function writeIndex(index: IndexFile): Promise<void> {
  await mkdir(FILES_DIR, { recursive: true });
  await writeFile(TEMP_INDEX, JSON.stringify(index), "utf8");
  await rename(TEMP_INDEX, INDEX);
}

// Read-modify-write cycles run one at a time.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

const newId = (): string => randomBytes(10).toString("hex");
const ID = /^[a-f0-9]{20}$/;
export const isValidBuilderId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

/** The file's public fields — the store it belongs to stays on the server. */
const strip = (file: SavedFile & { shop: string }): SavedFile => ({ id: file.id, name: file.name, kind: file.kind, size: file.size, hash: file.hash, createdAt: file.createdAt });

/** Saves an uploaded file's text. The same content already saved under this store is reused, not duplicated. */
export function addFile(shop: string, name: string, kind: SavedFile["kind"], content: string): Promise<SavedFile> {
  return locked(async () => {
    const index = await readIndex();
    const hash = createHash("sha256").update(content).digest("hex");
    const existing = index.files.find((file) => file.shop === shop && file.hash === hash);
    if (existing) return strip(existing);
    const file: SavedFile & { shop: string } = { id: newId(), shop, name: name.slice(0, 200), kind, size: Buffer.byteLength(content), hash, createdAt: new Date().toISOString() };
    await mkdir(FILES_DIR, { recursive: true });
    await writeFile(path.join(FILES_DIR, `${file.id}.txt`), content, "utf8");
    const kept = [...index.files, file];
    const dropped = kept.length > MAX_FILES ? kept.slice(0, kept.length - MAX_FILES) : [];
    for (const old of dropped) await rm(path.join(FILES_DIR, `${old.id}.txt`), { force: true });
    await writeIndex({ ...index, files: kept.slice(-MAX_FILES) });
    return strip(file);
  });
}

export async function listFiles(shop: string): Promise<SavedFile[]> {
  return (await readIndex()).files.filter((file) => file.shop === shop).map(strip).reverse();
}

export async function readSavedFile(shop: string, id: string): Promise<{ file: SavedFile; content: string } | null> {
  const file = (await readIndex()).files.find((candidate) => candidate.id === id && candidate.shop === shop);
  if (!file) return null;
  try {
    return { file: strip(file), content: await readFile(path.join(FILES_DIR, `${file.id}.txt`), "utf8") };
  } catch {
    return null;
  }
}

export function removeFile(shop: string, id: string): Promise<void> {
  return locked(async () => {
    const index = await readIndex();
    if (!index.files.some((file) => file.id === id && file.shop === shop)) return;
    await rm(path.join(FILES_DIR, `${id}.txt`), { force: true });
    await writeIndex({ ...index, files: index.files.filter((file) => file.id !== id) });
  });
}

export function addActivity(shop: string, entry: Omit<ActivityEntry, "id" | "shop" | "createdAt" | "revertedAt">): Promise<ActivityEntry> {
  return locked(async () => {
    const index = await readIndex();
    const full: ActivityEntry = { ...entry, id: newId(), shop, createdAt: new Date().toISOString(), revertedAt: null };
    await writeIndex({ ...index, activity: [...index.activity, full].slice(-MAX_ACTIVITY) });
    return full;
  });
}

export async function listActivity(shop: string): Promise<ActivityEntry[]> {
  return (await readIndex()).activity.filter((entry) => entry.shop === shop).reverse();
}

export async function getActivity(shop: string, id: string): Promise<ActivityEntry | null> {
  return (await readIndex()).activity.find((entry) => entry.id === id && entry.shop === shop) ?? null;
}

export function markActivityReverted(shop: string, id: string): Promise<void> {
  return locked(async () => {
    const index = await readIndex();
    const entry = index.activity.find((candidate) => candidate.id === id && candidate.shop === shop);
    if (!entry) return;
    entry.revertedAt = new Date().toISOString();
    await writeIndex(index);
  });
}

export function removeActivity(shop: string, id: string): Promise<void> {
  return locked(async () => {
    const index = await readIndex();
    await writeIndex({ ...index, activity: index.activity.filter((entry) => !(entry.id === id && entry.shop === shop)) });
  });
}
