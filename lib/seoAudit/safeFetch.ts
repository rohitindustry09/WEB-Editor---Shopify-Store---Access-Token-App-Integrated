import "server-only";
import * as dns from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";

/** Thrown whenever a request is refused for landing on a private, loopback, link-local, or otherwise non-public address — including on a redirect hop, not just the initial URL. */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** The URL actually fetched, after following any redirects. */
  finalUrl: string;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD" | "POST";
  timeoutMs?: number;
  maxRedirects?: number;
  /** Aborts the response once its body exceeds this many bytes — a large/unbounded page can't exhaust memory. */
  maxBytes?: number;
  /** Extra request headers (e.g. `Accept`, `Content-Type`) merged over the defaults. */
  headers?: Record<string, string>;
  /** Request body for POST (e.g. a GraphQL query) — sent as-is, caller sets a matching Content-Type header. */
  body?: string;
  /**
   * Skips TLS certificate verification for this request only — an explicit,
   * per-request opt-in for a store on shared hosting with a broken/mismatched
   * cert, never a global setting. Does NOT weaken the SSRF protection above:
   * DNS resolution and IP validation still run first and still refuse
   * private/loopback addresses regardless of this flag.
   */
  allowInsecureTls?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const USER_AGENT = "BrasstownSeoAudit/1.0 (+https://github.com)";

function ipv4ToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

/** CIDR ranges (as [network, prefixLength]) covering every private, loopback, link-local, carrier-NAT, documentation, multicast, and reserved IPv4 block — including 169.254.169.254, the cloud metadata endpoint that's the classic SSRF target. */
const BLOCKED_IPV4_CIDRS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function isBlockedIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (!parts) return true; // unparsable — refuse rather than guess
  const addrInt = ipv4ToInt(parts);
  return BLOCKED_IPV4_CIDRS.some(([network, prefix]) => {
    const networkParts = parseIpv4(network);
    if (!networkParts) return false;
    const networkInt = ipv4ToInt(networkParts);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (addrInt & mask) === (networkInt & mask);
  });
}

/** Expands an IPv6 address to its 8 hextet groups, resolving `::` compression, so the prefix checks below don't have to special-case shorthand notation. */
function expandIpv6(address: string): number[] | null {
  const withoutZone = address.split("%")[0];
  const halves = withoutZone.split("::");
  if (halves.length > 2) return null;

  const parseGroup = (group: string): number[] => {
    if (group === "") return [];
    return group.split(":").map((h) => parseInt(h, 16));
  };

  const head = parseGroup(halves[0]);
  const tail = halves.length === 2 ? parseGroup(halves[1]) : [];
  if (head.some((h) => Number.isNaN(h)) || tail.some((h) => Number.isNaN(h))) return null;

  const missing = 8 - head.length - tail.length;
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  if (missing < 0) return null;
  return [...head, ...new Array(missing).fill(0), ...tail];
}

function isBlockedIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return true; // unparsable — refuse rather than guess

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses —
  // unwrap to the embedded IPv4 address and apply the same IPv4 rules,
  // otherwise this is a straightforward bypass of every check above.
  const isV4Mapped = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0;
  if (isV4Mapped && (groups[5] === 0xffff || groups[5] === 0)) {
    const a = (groups[6] >> 8) & 0xff;
    const b = groups[6] & 0xff;
    const c = (groups[7] >> 8) & 0xff;
    const d = groups[7] & 0xff;
    return isBlockedIpv4(`${a}.${b}.${c}.${d}`);
  }

  const isLoopback = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
  const isUnspecified = groups.every((g) => g === 0);
  const isUniqueLocal = (groups[0] & 0xfe00) === 0xfc00; // fc00::/7
  const isLinkLocal = (groups[0] & 0xffc0) === 0xfe80; // fe80::/10
  const isDocumentation = groups[0] === 0x2001 && groups[1] === 0xdb8; // 2001:db8::/32
  const isMulticast = (groups[0] & 0xff00) === 0xff00; // ff00::/8

  return isLoopback || isUnspecified || isUniqueLocal || isLinkLocal || isDocumentation || isMulticast;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
}

/**
 * Resolves `hostname` and returns the first public address found, or throws
 * `SsrfBlockedError`. Every address a domain resolves to is checked — a
 * multi-homed or round-robin DNS record only needs ONE public-looking entry
 * to slip a naive "check the first result" implementation past this.
 */
async function resolveAndValidate(hostname: string): Promise<{ address: string; family: number }> {
  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError(`Couldn't resolve "${hostname}".`);
  }
  if (records.length === 0) {
    throw new SsrfBlockedError(`Couldn't resolve "${hostname}".`);
  }
  if (records.some((r) => isBlockedAddress(r.address, r.family))) {
    throw new SsrfBlockedError(`"${hostname}" resolves to a private, loopback, or otherwise non-public address, which isn't allowed.`);
  }
  return records[0];
}

/**
 * A hardened fetch for URLs whose host comes from user input (the whole
 * point of this feature). Three things a plain `fetch()` doesn't do:
 *
 * 1. Resolves DNS itself and rejects private/loopback/link-local/reserved
 *    addresses (including the classic 169.254.169.254 cloud metadata
 *    target) BEFORE connecting.
 * 2. Pins the actual TCP connection to that validated IP via Node's
 *    `lookup` override, rather than letting the request re-resolve DNS on
 *    its own — re-resolving would reopen a DNS-rebinding gap (the record
 *    could point somewhere private by the time the real connection
 *    happens, even though the check a moment earlier passed). The TLS
 *    `servername`/Host header still uses the original hostname, so
 *    certificate validation and virtual-hosting keep working normally.
 * 3. Re-validates the TARGET of every redirect through the same check
 *    before following it — a same-origin-looking URL can still redirect
 *    to an internal address, and that hop needs the identical scrutiny as
 *    the first one, not a pass because the first hop already cleared it.
 */
interface RawSafeFetchResult {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
  finalUrl: string;
}

/**
 * The shared core behind `safeFetch` and `safeFetchBinary` — identical SSRF
 * validation, redirect handling, and DNS pinning either way; the only
 * difference between the two public functions is whether the collected
 * bytes get decoded as UTF-8 text or handed back raw, which matters a lot
 * for binary content (images) where decoding as text would corrupt it.
 */
async function performSafeRequest(inputUrl: string, options: SafeFetchOptions): Promise<RawSafeFetchResult> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const body = options.body;

  let currentUrl = inputUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SsrfBlockedError(`"${parsed.protocol}" isn't an allowed URL scheme — only http and https are.`);
    }

    const resolved = await resolveAndValidate(parsed.hostname);
    const transport = parsed.protocol === "https:" ? https : http;

    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: Buffer; location?: string }>(
      (resolve, reject) => {
        const req = transport.request(
          {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: `${parsed.pathname}${parsed.search}`,
            method,
            headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*", ...options.headers },
            timeout: timeoutMs,
            ...(parsed.protocol === "https:" && options.allowInsecureTls ? { rejectUnauthorized: false } : {}),
            // The pinning itself: ignores whatever DNS would resolve at
            // connect time and hands back the address already validated
            // above. Node's internal `net` module calls this two
            // different ways depending on its own Happy-Eyeballs
            // (dual-stack) behavior — `options.all` true wants an array
            // of `{address, family}` back, false/absent wants the older
            // 3-arg `(err, address, family)` form. Handling only one of
            // these throws `ERR_INVALID_IP_ADDRESS: undefined` deep
            // inside `net`, confirmed by reproducing it directly.
            lookup: (_hostname, options, callback) => {
              if (typeof options === "object" && options !== null && "all" in options && options.all) {
                (callback as (err: null, addresses: { address: string; family: number }[]) => void)(null, [
                  { address: resolved.address, family: resolved.family },
                ]);
              } else {
                callback(null, resolved.address, resolved.family);
              }
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            let received = 0;
            res.on("data", (chunk: Buffer) => {
              received += chunk.length;
              if (received > maxBytes) {
                res.destroy();
                reject(new Error(`Response exceeded the ${maxBytes}-byte cap.`));
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => {
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                bytes: Buffer.concat(chunks),
                location: res.headers.location,
              });
            });
            res.on("error", reject);
          },
        );

        req.on("timeout", () => {
          req.destroy(new Error(`Request to ${parsed.hostname} timed out after ${timeoutMs}ms.`));
        });
        req.on("error", reject);
        req.end(body);
      },
    );

    const isRedirect = result.status >= 300 && result.status < 400;
    if (isRedirect && result.location) {
      if (hop === maxRedirects) {
        throw new SsrfBlockedError(`Too many redirects (over ${maxRedirects}) while fetching ${inputUrl}.`);
      }
      // Resolved against the current URL so a relative Location header
      // (very common) lands on the right absolute URL — then the loop's
      // next iteration validates THIS hostname from scratch.
      currentUrl = new URL(result.location, currentUrl).toString();
      continue;
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(result.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }

    return { status: result.status, headers, bytes: result.bytes, finalUrl: currentUrl };
  }

  throw new SsrfBlockedError(`Too many redirects (over ${maxRedirects}) while fetching ${inputUrl}.`);
}

export async function safeFetch(inputUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const result = await performSafeRequest(inputUrl, options);
  return { status: result.status, headers: result.headers, body: result.bytes.toString("utf-8"), finalUrl: result.finalUrl };
}

export interface SafeFetchBinaryResult {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
  finalUrl: string;
}

/** Same SSRF-guarded fetch as `safeFetch`, but hands back raw bytes instead of decoding as UTF-8 text — required for binary content (images, media) where text-decoding would corrupt the data. */
export async function safeFetchBinary(inputUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchBinaryResult> {
  return performSafeRequest(inputUrl, options);
}
