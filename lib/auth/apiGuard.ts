import "server-only";
import { NextResponse } from "next/server";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/sameOrigin";

const READ_METHODS = new Set(["GET", "HEAD"]);

/**
 * The real sign-in check for API routes. The proxy only confirms that session cookies are *present*
 * (it cannot verify the signature on the Edge), so a route must call this itself: it verifies the signed
 * sign-in cookie, and for anything that changes state also requires the request to come from this site's own pages.
 * Returns a ready response to send back when the request is refused, or null when it may go ahead.
 */
export async function guardApi(request: Request): Promise<NextResponse | null> {
  if (!(await getAuthenticatedStore())) {
    return NextResponse.json({ ok: false, error: "You're signed out. Sign in again." }, { status: 401 });
  }
  if (!READ_METHODS.has(request.method) && !isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Cross-site request refused." }, { status: 403 });
  }
  return null;
}
