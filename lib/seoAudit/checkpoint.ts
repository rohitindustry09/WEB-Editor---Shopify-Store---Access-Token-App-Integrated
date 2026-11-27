import "server-only";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Finding, ParsedPage } from "./types";

/**
 * Saved crawl progress, so an audit can be resumed instead of starting again. One append-only file per site
 * (`data/seo-audit/<site>.ndjson`, one JSON line per page) plus a small meta file for the "saved progress" summary.
 * Appending means a crash or a cancel loses at most the last line. On a host whose disk is read-only (e.g. Vercel)
 * every call quietly does nothing, and the audit simply runs without saving.
 */

const DIR = path.join(process.cwd(), "data", "seo-audit");
/** Saved data older than this is ignored and removed, so a stale picture of the site is never reused by accident. */
export const CHECKPOINT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const META_EVERY = 25;

export interface PageRecord {
  url: string;
  /** "retry" = the fetch failed in a way that may pass next time (rate limit, timeout): never reused on resume. */
  outcome: "ok" | "skipped" | "error" | "retry";
  findings: Finding[];
  parsed: ParsedPage | null;
  /** The message shown in the live feed for error / retry outcomes. */
  message?: string;
}

export interface CheckpointMeta {
  site: string;
  savedAt: string;
  /** Pages with a final result that a resume will reuse. */
  pages: number;
  /** Pages that failed in a retryable way and will be fetched again. */
  retryable: number;
  /** Pages the run was aiming for, when known. */
  total: number | null;
  complete: boolean;
}

/** `www.example.com` and `example.com` share one saved crawl. Only letters, digits, dots and dashes survive, so the name can't escape the folder. */
export function siteKey(host: string, owner: string): string {
  const site = host.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "-").slice(0, 120);
  // Filed under the anonymous visitor that ran the crawl (a UUID, so safe in a file name), so nobody resumes or reads someone else's.
  return `${owner}__${site}`;
}

const file = (site: string, ext: string): string => path.join(DIR, `${site}.${ext}`);

/** Homepage text feeds keyword density; every other page's text is never read again, so it is not stored (keeps the file small). */
function slim(record: PageRecord): PageRecord {
  if (!record.parsed) return record;
  let isHome = false;
  try {
    isHome = new URL(record.parsed.url).pathname === "/";
  } catch {
    isHome = false;
  }
  return isHome ? record : { ...record, parsed: { ...record.parsed, textContent: "" } };
}

export async function readMeta(site: string): Promise<CheckpointMeta | null> {
  try {
    const meta = JSON.parse(await readFile(file(site, "meta.json"), "utf8")) as CheckpointMeta;
    if (Date.now() - Date.parse(meta.savedAt) > CHECKPOINT_MAX_AGE_MS) {
      await clearCheckpoint(site);
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

export async function clearCheckpoint(site: string): Promise<void> {
  await rm(file(site, "ndjson"), { force: true }).catch(() => undefined);
  await rm(file(site, "meta.json"), { force: true }).catch(() => undefined);
}

/** Every saved page that has a final result (retryable ones are left out so they get fetched again). */
export async function loadRecords(site: string): Promise<Map<string, PageRecord>> {
  const records = new Map<string, PageRecord>();
  let text: string;
  try {
    text = await readFile(file(site, "ndjson"), "utf8");
  } catch {
    return records;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as PageRecord;
      if (record.outcome === "retry") records.delete(record.url);
      else records.set(record.url, record);
    } catch {
      // a half-written last line from an interrupted run — ignore it
    }
  }
  return records;
}

export interface CheckpointWriter {
  save(record: PageRecord): void;
  /** Writes the final summary and waits for everything queued to reach the disk. */
  finish(total: number | null, complete: boolean): Promise<void>;
}

/** Starts (or continues) saving a crawl. `alreadySaved` is how many results a resume loaded, so the totals stay accurate. */
export function openCheckpoint(site: string, alreadySaved: number): CheckpointWriter {
  let writable = true;
  let pages = alreadySaved;
  let retryable = 0;
  let sinceMeta = 0;
  let queue: Promise<unknown> = mkdir(DIR, { recursive: true }).catch(() => {
    writable = false;
  });

  const writeMeta = (total: number | null, complete: boolean): Promise<unknown> => {
    const meta: CheckpointMeta = { site, savedAt: new Date().toISOString(), pages, retryable, total, complete };
    return writeFile(file(site, "meta.json"), JSON.stringify(meta), "utf8").catch(() => {
      writable = false;
    });
  };

  return {
    save(record) {
      if (!writable) return;
      if (record.outcome === "retry") retryable += 1;
      else pages += 1;
      sinceMeta += 1;
      const line = JSON.stringify(slim(record)) + "\n";
      queue = queue.then(() =>
        writable
          ? appendFile(file(site, "ndjson"), line, "utf8").catch(() => {
              writable = false;
            })
          : undefined,
      );
      if (sinceMeta >= META_EVERY) {
        sinceMeta = 0;
        queue = queue.then(() => (writable ? writeMeta(null, false) : undefined));
      }
    },
    async finish(total, complete) {
      queue = queue.then(() => (writable ? writeMeta(total, complete) : undefined));
      await queue;
    },
  };
}
