import { NextResponse, type NextRequest } from "next/server";
import { SHOP_COOKIE, TOKEN_COOKIE } from "@/lib/shopify/config";
import { AUTH_COOKIE } from "@/lib/auth/cookie";

/**
 * The connect wizard is the front door: you reach it without signing in, and pasting a store's access key
 * on its last step is what signs you in. (The handlers behind /api/connect and /api/disconnect check for themselves.)
 */
const PUBLIC_PATHS = ["/connect", "/api/connect", "/api/disconnect", "/api/auth/shopify"];

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Cheap gate that runs on the Edge: it can only check that the session cookies
 * are *present*, since verifying the signature needs Node crypto. The real
 * check happens in the app/connect layouts, which run on the server — this
 * exists so an unauthenticated request is bounced without paying for a full
 * server render first.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/" || matches(pathname, PUBLIC_PATHS)) return NextResponse.next();

  if (!request.cookies.has(AUTH_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/connect";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const hasShopifySession = request.cookies.has(SHOP_COOKIE) && request.cookies.has(TOKEN_COOKIE);
  if (!hasShopifySession) {
    const url = request.nextUrl.clone();
    url.pathname = "/connect";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skips static assets and image requests entirely so the gate only runs on
  // real navigations and API calls.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff2?)$).*)"],
};
