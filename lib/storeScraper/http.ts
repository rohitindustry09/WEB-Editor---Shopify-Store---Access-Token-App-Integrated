import "server-only";
import { safeFetch, SsrfBlockedError, type SafeFetchOptions } from "@/lib/seoAudit/safeFetch";

// A discovery page failing after retries used to kill the ENTIRE job (see
// jobRunner.ts's fix for why that's wrong on its own) — but retries should
// still give a transient 429/5xx a real chance to clear before giving up,
// since with the per-origin pacing below actually preventing most 429s,
// the ones that still occur are more likely a genuine transient blip.
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 400;
const MAX_RETRY_DELAY_MS = 10_000;

// How fast this paces new requests to a single origin — regardless of how
// many concurrent workers are scraping it. This is the actual fix for
// cascading 429s: bumping worker concurrency without pacing just means
// more parallel requests arrive at the store at once. Pacing request
// STARTS this way (rather than capping concurrency alone) still lets
// multiple requests be in flight at once — it only limits how fast NEW
// ones begin — so it costs little real throughput against a store that
// isn't near its limit, while protecting one that is.
//
// The pace is ADAPTIVE per origin (AIMD — the same congestion-control
// shape TCP uses), not a fixed number: a fixed "safe for every store"
// ceiling is either too slow for a lenient store or still too fast for a
// strict one, and there's no way to know which without trying. Every
// origin starts at a fairly quick pace; each 429/5xx nudges it slower
// (multiplicatively, so a real problem backs off fast); a run of clean
// successes nudges it back faster (additively, so recovery is gradual and
// doesn't immediately re-trigger the same limit). A generous store ends up
// scraped close to its real ceiling instead of an arbitrary conservative
// guess; a strict one still converges down to something it tolerates,
// automatically, without needing to be retuned by hand per store.
const START_INTERVAL_MS = 110; // ~9 req/sec to start
const MIN_INTERVAL_MS = 45; // ~22 req/sec ceiling — fast, but not "hammer it" fast
const MAX_INTERVAL_MS = 800; // ~1.25 req/sec floor for a genuinely strict store
const BACKOFF_MULTIPLIER = 1.7;
const RECOVERY_MULTIPLIER = 0.92;
const SUCCESSES_BEFORE_RECOVERY = 8;

interface OriginPacing {
  intervalMs: number;
  consecutiveSuccesses: number;
  chain: Promise<number>;
}

const originPacing = new Map<string, OriginPacing>();

function pacingFor(origin: string): OriginPacing {
  let pacing = originPacing.get(origin);
  if (!pacing) {
    pacing = { intervalMs: START_INTERVAL_MS, consecutiveSuccesses: 0, chain: Promise.resolve(0) };
    originPacing.set(origin, pacing);
  }
  return pacing;
}

/** Slows this origin down after a 429/5xx — multiplicative, so a real problem is backed off from quickly rather than creeping down over many failures. */
function recordThrottled(origin: string): void {
  const pacing = pacingFor(origin);
  pacing.intervalMs = Math.min(MAX_INTERVAL_MS, Math.round(pacing.intervalMs * BACKOFF_MULTIPLIER));
  pacing.consecutiveSuccesses = 0;
}

/** Speeds this origin back up after a sustained run of clean responses — gradual on purpose, so recovery doesn't immediately re-trigger the same limit it just backed off from. */
function recordSuccess(origin: string): void {
  const pacing = pacingFor(origin);
  pacing.consecutiveSuccesses += 1;
  if (pacing.consecutiveSuccesses >= SUCCESSES_BEFORE_RECOVERY) {
    pacing.intervalMs = Math.max(MIN_INTERVAL_MS, Math.round(pacing.intervalMs * RECOVERY_MULTIPLIER));
    pacing.consecutiveSuccesses = 0;
  }
}

/** Serializes "when is this origin's next request allowed to start," at whatever pace `originPacing` currently holds for it. Synchronous up through the `.set()`-equivalent (the `chain` reassignment) so concurrent callers chain in arrival order with no race. */
function reserveOriginSlot(origin: string): Promise<void> {
  const pacing = pacingFor(origin);
  const reserved = pacing.chain.then(async (lastStart) => {
    const now = Date.now();
    const wait = lastStart + pacing.intervalMs - now;
    if (wait > 0) await sleep(wait);
    return Date.now();
  });
  pacing.chain = reserved;
  return reserved.then(() => undefined);
}

export class HttpStatusError extends Error {
  status: number;
  retryable: boolean;
  constructor(status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
    this.retryable = retryable;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches through `safeFetch` (SSRF-guarded) with retry-on-transient-failure
 * only: 429 and 5xx responses, plus network/timeout errors, back off
 * exponentially and retry. Everything else (404, 401, 403, a blocked SSRF
 * target, DNS failure) throws immediately — retrying those just wastes time
 * against a result that will never change.
 */
export async function fetchWithRetry(url: string, options: SafeFetchOptions = {}): Promise<{ status: number; body: string; finalUrl: string }> {
  let lastError: unknown;
  const origin = new URL(url).origin;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await reserveOriginSlot(origin);
      const result = await safeFetch(url, options);
      if (result.status === 429 || result.status >= 500) {
        recordThrottled(origin);
        const retryAfterHeader = result.headers["retry-after"];
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
        if (attempt === MAX_RETRIES) {
          throw new HttpStatusError(result.status, `${url} responded ${result.status} after ${MAX_RETRIES + 1} attempts.`, true);
        }
        const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
        await sleep(retryAfterMs && Number.isFinite(retryAfterMs) ? Math.max(retryAfterMs, backoff) : backoff);
        continue;
      }
      if (result.status >= 400) {
        // Not a rate-limit signal (a 404/401/403 doesn't mean "too fast") —
        // doesn't affect pacing either way.
        throw new HttpStatusError(result.status, `${url} responded ${result.status}.`, false);
      }
      recordSuccess(origin);
      return { status: result.status, body: result.body, finalUrl: result.finalUrl };
    } catch (err) {
      if (err instanceof SsrfBlockedError) throw err;
      if (err instanceof HttpStatusError && !err.retryable) throw err;
      lastError = err;
      if (attempt === MAX_RETRIES) break;
      const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
      await sleep(backoff);
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`Failed to fetch ${url}.`);
}

export async function fetchJson<T>(url: string, options: SafeFetchOptions = {}): Promise<T> {
  const result = await fetchWithRetry(url, { ...options, headers: { Accept: "application/json", ...options.headers } });
  try {
    return JSON.parse(result.body) as T;
  } catch {
    throw new Error(`${url} didn't return valid JSON.`);
  }
}

export async function fetchHtml(url: string, options: SafeFetchOptions = {}): Promise<string> {
  const result = await fetchWithRetry(url, options);
  return result.body;
}

export async function fetchGraphql<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  options: SafeFetchOptions = {},
): Promise<T> {
  const result = await fetchWithRetry(endpoint, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...options.headers },
    body: JSON.stringify({ query, variables }),
  });
  const parsed = JSON.parse(result.body) as { data?: T; errors?: { message: string }[] };
  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((e) => e.message).join("; "));
  }
  if (!parsed.data) throw new Error(`${endpoint} returned no data.`);
  return parsed.data;
}
