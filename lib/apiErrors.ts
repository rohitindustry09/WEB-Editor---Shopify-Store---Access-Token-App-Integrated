import { scopesMentionedIn } from "./scopeInfo";

export interface ApiErrorInfo {
  /** The message with repeated sentences collapsed to one. */
  message: string;
  /** Access scopes the message says are missing. */
  scopes: string[];
  /** Shopify wants "protected customer data" approval for this (customer / order personal details). */
  protectedData: boolean;
  /** The message says personal data is limited to certain Shopify plans. */
  planLimited: boolean;
  /** The app-configuration link Shopify put in the message, if any. */
  settingsUrl?: string;
}

const OBJECT_SCOPES: Record<string, string> = { customer: "read_customers", order: "read_orders" };

const SETTINGS_URL = /https:\/\/admin\.shopify\.com\/store\/[^\s;]+\/settings\/apps\/[^\s;]+/i;

/** Splits on Shopify's "; " joiner and keeps each distinct sentence once — one failing field can repeat the same error many times. */
export function dedupeMessage(raw: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of raw.split(/;\s+/)) {
    const key = part.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      parts.push(key);
    }
  }
  return parts.join("; ");
}

/** Reads a Shopify error and works out which access it is asking for. */
export function describeApiError(raw: string): ApiErrorInfo {
  const message = dedupeMessage(raw);
  const scopes = scopesMentionedIn(message);
  // "not approved to access the Customer object" names an object, not a scope — the matching read scope is needed too.
  const object = /not approved to access the (\w+) object/i.exec(message)?.[1]?.toLowerCase();
  const implied = object ? OBJECT_SCOPES[object] : undefined;
  if (implied && !scopes.includes(implied)) scopes.push(implied);
  return {
    message,
    scopes,
    protectedData: /not approved to access the \w+ object|protected customer data/i.test(message),
    planLimited: /only available on .*(advanced|plus)/i.test(message),
    settingsUrl: SETTINGS_URL.exec(message)?.[0],
  };
}

/** Where, in the Shopify admin, an app's access is configured. */
export function appsAdminUrl(shopDomain: string): string | undefined {
  const handle = shopDomain.replace(/\.myshopify\.com$/i, "");
  return handle ? `https://admin.shopify.com/store/${handle}/settings/apps/development` : undefined;
}
