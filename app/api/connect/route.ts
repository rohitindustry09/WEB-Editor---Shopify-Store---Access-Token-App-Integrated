import { NextResponse } from "next/server";
import { startAuthSession } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/sameOrigin";
import { ShopifyAPIError, shopifyGraphQLRaw } from "@/lib/shopify/client";
import { setSession } from "@/lib/shopify/session";
import { testShopConnection } from "@/lib/shopify/shop";
import { parseShopDomain } from "@/lib/shopify/storeDomain";

interface ConnectBody {
  storeName: string;
  token: string;
  /** The scopes picked in the wizard — only used if Shopify can't list what the key really has. */
  scopes?: string[];
}

const MIN_TOKEN_LENGTH = 20;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const SCOPES_QUERY = `query GrantedScopes { currentAppInstallation { accessScopes { handle } } }`;

/** Wrong-key attempts per store, so this open endpoint can't be used to hammer a store with guesses. */
const failures = new Map<string, number[]>();

function recentFailures(shop: string): number[] {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  const recent = (failures.get(shop) ?? []).filter((at) => at > cutoff);
  failures.set(shop, recent);
  return recent;
}

/** The scopes the key really has, read from Shopify with that key (null when they can't be read). */
async function readGrantedScopes(shop: string, token: string): Promise<string[] | null> {
  try {
    const data = await shopifyGraphQLRaw<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>(shop, token, SCOPES_QUERY);
    return data.currentAppInstallation.accessScopes.map((scope) => scope.handle);
  } catch {
    return null;
  }
}

/**
 * The sign-in. The wizard's last step posts the store name and the Admin API access key here; the key is
 * checked against that store, and only if Shopify accepts it are the signed sign-in cookie and the store
 * session created. There are no separate accounts or passwords — holding a valid key is the credential.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Cross-site request refused." }, { status: 403 });
  }

  let body: ConnectBody;
  try {
    body = (await request.json()) as ConnectBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }

  const parsed = typeof body.storeName === "string" ? parseShopDomain(body.storeName) : null;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!parsed) {
    return NextResponse.json({ ok: false, error: "Enter a valid store name, like your-store." }, { status: 400 });
  }
  if (token.length < MIN_TOKEN_LENGTH || /\s/.test(token)) {
    return NextResponse.json({ ok: false, error: "That doesn't look like an Admin API access token — it is a long code that starts with shpat_." }, { status: 400 });
  }
  // Only a plain store handle reaches this point, so the key can only be sent to that store's own host.
  const { shop, name } = parsed;

  if (recentFailures(shop).length >= MAX_FAILURES) {
    return NextResponse.json({ ok: false, error: "Too many wrong keys for this store. Wait a few minutes and try again." }, { status: 429 });
  }

  try {
    const shopInfo = await testShopConnection(shop, token);
    failures.delete(shop);
    const granted = await readGrantedScopes(shop, token);
    await startAuthSession(name);
    await setSession({ shop, token, scopes: granted ?? (Array.isArray(body.scopes) ? body.scopes.filter((s) => typeof s === "string") : []) });
    return NextResponse.json({ ok: true, shopName: shopInfo.name, domain: shopInfo.myshopifyDomain, granted });
  } catch (error) {
    failures.set(shop, [...recentFailures(shop), Date.now()]);
    const message = error instanceof ShopifyAPIError ? error.message : "Couldn't verify that token against this store.";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}
