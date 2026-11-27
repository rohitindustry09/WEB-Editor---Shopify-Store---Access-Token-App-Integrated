import { NextResponse, type NextRequest } from "next/server";
import { SHOP_COOKIE, TOKEN_COOKIE } from "@/lib/shopify/config";
import { AUTH_COOKIE } from "@/lib/auth/cookie";
import { VISITOR_COOKIE, VISITOR_HEADER, VISITOR_ID, VISITOR_MAX_AGE_SECONDS, isOpenPage, isPublicPage } from "@/lib/accessPolicy";

/**
 * The app is open: anyone can look around, and the free tools (see accessPolicy.ts) work without logging in. Two jobs here:
 *
 *  1. Give every browser an anonymous visitor ID (a cookie), and hand it to the server code in a header the proxy always
 *     overwrites — so the free tools can keep each browser's runs, uploads and settings private without any account.
 *  2. A Shopify page opened without a connected store is shown the "please log in" page instead (the address stays the same),
 *     so no page is rendered — and no store data requested — for someone who isn't connected.
 *
 * This runs on the Edge, so it can only check that the session cookies are *present*. The real checks happen on the server:
 * the layout verifies the signed cookie, and every Shopify API route verifies it again (guardApi).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const existing = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitor = existing && VISITOR_ID.test(existing) ? existing : crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set(VISITOR_HEADER, visitor);

  const hasShopifySession = request.cookies.has(AUTH_COOKIE) && request.cookies.has(SHOP_COOKIE) && request.cookies.has(TOKEN_COOKIE);
  const needsLogin = !hasShopifySession && !isPublicPage(pathname) && !isOpenPage(pathname);

  const response = needsLogin ? NextResponse.rewrite(new URL("/login-required", request.url), { request: { headers } }) : NextResponse.next({ request: { headers } });
  if (visitor !== existing) {
    response.cookies.set(VISITOR_COOKIE, visitor, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: VISITOR_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export const config = {
  // Skips static assets and image requests entirely so this only runs on real navigations and API calls.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff2?)$).*)"],
};
