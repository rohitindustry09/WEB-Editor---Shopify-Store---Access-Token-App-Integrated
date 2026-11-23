import { NextResponse } from "next/server";
import { appBaseUrl, buildAuthorizeUrl, callbackUrl, getOAuthConfig, newState, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/shopify/oauth";
import { parseShopDomain } from "@/lib/shopify/storeDomain";

export const dynamic = "force-dynamic";

/**
 * Step one of "Connect with Shopify": validates the store, remembers a one-time state value in a short-lived
 * cookie, and sends the browser to Shopify's approval page. Reachable without signing in — it is how you sign in.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (message: string) => NextResponse.redirect(`${appBaseUrl(request.url)}/connect?oauth_error=${encodeURIComponent(message)}`);

  const parsed = parseShopDomain(url.searchParams.get("shop") ?? "");
  if (!parsed) return back("Enter a valid store name first, like your-store.");
  const config = getOAuthConfig();
  if (!config) return back("Connect with Shopify isn't set up on this server yet — it needs SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.");

  const state = newState();
  const response = NextResponse.redirect(buildAuthorizeUrl(config, parsed.shop, callbackUrl(request.url), state));
  response.cookies.set(OAUTH_STATE_COOKIE, JSON.stringify({ state, shop: parsed.shop }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: the cookie must come back on Shopify's redirect, which is a top-level GET navigation.
    sameSite: "lax",
    path: "/api/auth/shopify",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
  return response;
}
