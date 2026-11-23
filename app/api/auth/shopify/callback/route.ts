import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { startAuthSession } from "@/lib/auth/session";
import { appBaseUrl, checkCallback, exchangeCode, getOAuthConfig, OAUTH_STATE_COOKIE } from "@/lib/shopify/oauth";
import { setSession } from "@/lib/shopify/session";
import { testShopConnection } from "@/lib/shopify/shop";

export const dynamic = "force-dynamic";

function readStateCookie(raw: string | undefined): { state: string; shop: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { state?: unknown; shop?: unknown };
    return typeof value.state === "string" && typeof value.shop === "string" ? { state: value.state, shop: value.shop } : null;
  } catch {
    return null;
  }
}

/**
 * Step two of "Connect with Shopify": Shopify sends the visitor back here with a one-time code. Nothing is trusted
 * until Shopify's signature, the state value and the store all check out; only then is the code swapped for the
 * store's access token and the signed sign-in cookie and store session created.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = appBaseUrl(request.url);
  const fail = (message: string) => {
    const response = NextResponse.redirect(`${base}/connect?oauth_error=${encodeURIComponent(message)}`);
    response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth/shopify" });
    return response;
  };

  const config = getOAuthConfig();
  if (!config) return fail("Connect with Shopify isn't set up on this server yet — it needs SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.");
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") ?? "The app wasn't approved on Shopify.");

  const jar = await cookies();
  const check = checkCallback(url.searchParams, readStateCookie(jar.get(OAUTH_STATE_COOKIE)?.value), config.clientSecret);
  if (!check.ok) return fail(check.error);

  let token: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    token = await exchangeCode(config, check.shop, check.code);
    await testShopConnection(check.shop, token.accessToken);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Shopify didn't accept the approval.");
  }

  try {
    await startAuthSession(check.shop.replace(/\.myshopify\.com$/, ""));
    await setSession({ shop: check.shop, token: token.accessToken, scopes: token.scopes });
  } catch (err) {
    // For example: a read-only server with no AUTH_SECRET to sign the sign-in cookie.
    return fail(err instanceof Error ? err.message : "Shopify approved the app, but the server couldn't start your session.");
  }

  const response = NextResponse.redirect(`${base}/home`);
  response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth/shopify" });
  return response;
}
