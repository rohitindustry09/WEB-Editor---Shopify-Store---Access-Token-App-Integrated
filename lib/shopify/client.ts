import "server-only";
import { adminGraphQLUrl } from "./config";
import { dedupeMessage } from "../apiErrors";
import { scopesMentionedIn } from "../scopeInfo";
import { getSession } from "./session";

export class ShopifyNotConnectedError extends Error {
  constructor() {
    super("Not connected to a Shopify store.");
    this.name = "ShopifyNotConnectedError";
  }
}

export class ShopifyAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ShopifyAPIError";
  }
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string; requiredAccess?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
}

/** Shopify rations API calls with a "cost bucket"; when it runs dry it answers "Throttled" (or HTTP 429) and expects the caller to wait. */
const MAX_THROTTLE_RETRIES = 8;
/** Calls in flight at once, per server process — keeps parallel workers (and several tools at once) from draining the bucket together. */
const MAX_IN_FLIGHT = 4;

let inFlight = 0;
const waiting: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) next();
  else inFlight -= 1;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long to wait before retrying: until the bucket has refilled enough for this call, or an exponential backoff with jitter. */
function throttleDelayMs(json: GraphQLResponse<unknown> | null, retryAfterHeader: string | null, attempt: number): number {
  const jitter = Math.random() * 400;
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000 + jitter;
  const cost = json?.extensions?.cost;
  const needed = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
  const restoreRate = cost?.throttleStatus?.restoreRate ?? 0;
  if (needed > 0 && restoreRate > 0) return Math.max(500, (needed / restoreRate) * 1000) + jitter;
  return Math.min(10_000, 800 * 2 ** attempt) + jitter;
}

const isThrottle = (errors: GraphQLError[] | undefined): boolean =>
  (errors ?? []).some((e) => e.extensions?.code === "THROTTLED" || /throttled/i.test(e.message));

async function shopifyGraphQLOnce<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown> | undefined,
  attempt: number,
): Promise<{ data: T } | { retryInMs: number }> {
  let res: Response;
  try {
    res = await fetch(adminGraphQLUrl(shop), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
  } catch {
    throw new ShopifyAPIError(
      `Couldn't reach ${shop}. Check the store domain and your network connection.`,
    );
  }

  if (res.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
    return { retryInMs: throttleDelayMs(null, res.headers.get("Retry-After"), attempt) };
  }
  if (res.status === 401 || res.status === 403) {
    throw new ShopifyAPIError(
      "That access token was rejected. It may be missing a required scope, or may have been revoked.",
      res.status,
    );
  }
  if (!res.ok) {
    throw new ShopifyAPIError(`Shopify returned ${res.status} ${res.statusText}`, res.status);
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    if (isThrottle(json.errors) && attempt < MAX_THROTTLE_RETRIES) {
      return { retryInMs: throttleDelayMs(json, null, attempt) };
    }
    const required = json.errors.flatMap((e) => (e.extensions?.requiredAccess ? scopesMentionedIn(e.extensions.requiredAccess) : []));
    const needed = [...new Set(required)];
    // One failing field can repeat the same error many times; say it once, and name the access scope that is missing.
    throw new ShopifyAPIError(dedupeMessage(json.errors.map((e) => e.message).join("; ")) + (needed.length > 0 ? ` Access needed: ${needed.join(", ")}.` : ""));
  }
  if (!json.data) {
    throw new ShopifyAPIError("Shopify returned no data for this request.");
  }
  return { data: json.data };
}

export async function shopifyGraphQLRaw<T>(
  shop: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  await acquireSlot();
  try {
    // A throttled call waits for the bucket to refill and tries again; it only gives up (with Shopify's own "Throttled" message) after several patient attempts.
    for (let attempt = 0; ; attempt++) {
      const outcome = await shopifyGraphQLOnce<T>(shop, token, query, variables, attempt);
      if ("data" in outcome) return outcome.data;
      await sleep(outcome.retryInMs);
    }
  } finally {
    releaseSlot();
  }
}

export async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const session = await getSession();
  if (!session) throw new ShopifyNotConnectedError();
  return shopifyGraphQLRaw<T>(session.shop, session.token, query, variables);
}
