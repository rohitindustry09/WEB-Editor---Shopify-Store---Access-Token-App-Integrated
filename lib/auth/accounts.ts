import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The secret that signs the sign-in cookie, persisted as JSON on disk.
 *
 * There are no passwords or accounts any more: signing in means proving you hold a store's Admin API access
 * key, and the signed cookie only records which store that was. The file lives at `<project>/data/stores.json`
 * — deliberately outside `.next/`, so `next build` never wipes it and sessions survive rebuilds. Older files
 * that still list accounts keep working; those entries are simply ignored.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "stores.json");
const TEMP_FILE = `${ACCOUNTS_FILE}.tmp`;
const SECRET_BYTES = 32;

interface AccountsFile {
  version: 1;
  /** Signs session cookies. Generated once, then reused so sessions survive restarts. */
  authSecret: string;
  accounts: unknown[];
}

/** Trims, lowercases, and drops a `.myshopify.com` suffix so one store is one name however it's typed. */
export function normalizeStoreName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.myshopify\.com.*$/, "")
    .replace(/\/+$/, "");
}

// Held in memory after the first read: every authenticated request verifies a cookie signature, and hitting the
// disk each time for a value that never changes at runtime is pure overhead.
let cachedSecret: string | null = null;

function isAccountsFile(value: unknown): value is AccountsFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AccountsFile>;
  return typeof candidate.authSecret === "string" && candidate.authSecret.length > 0 && Array.isArray(candidate.accounts);
}

async function readFileOrDefault(): Promise<AccountsFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(ACCOUNTS_FILE, "utf8"));
    if (isAccountsFile(parsed)) return parsed;
  } catch {
    // missing (first run) or unreadable — start from a fresh file
  }
  return { version: 1, authSecret: randomBytes(SECRET_BYTES).toString("hex"), accounts: [] };
}

async function persist(data: AccountsFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated file behind.
  await writeFile(TEMP_FILE, JSON.stringify(data, null, 2), "utf8");
  await rename(TEMP_FILE, ACCOUNTS_FILE);
}

let pending: Promise<string> | null = null;

/** The HMAC secret used to sign session cookies, created on first use and reused thereafter. */
export async function getAuthSecret(): Promise<string> {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (cachedSecret) return cachedSecret;
  // One creation at a time, so two first requests can't write two different secrets.
  pending ??= (async () => {
    const data = await readFileOrDefault();
    await persist(data);
    cachedSecret = data.authSecret;
    return data.authSecret;
  })().finally(() => {
    pending = null;
  });
  return pending;
}
