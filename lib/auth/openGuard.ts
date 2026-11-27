import "server-only";
import { NextResponse } from "next/server";
import { VISITOR_HEADER, VISITOR_ID } from "@/lib/accessPolicy";
import { isSameOrigin } from "@/lib/sameOrigin";

const READ_METHODS = new Set(["GET", "HEAD"]);

export type OpenGuard = { visitor: string; denied: null } | { visitor: null; denied: NextResponse };

/**
 * The gate for the free tools' APIs: no account and no Shopify store needed, but every request belongs to an anonymous
 * visitor (the ID the proxy attaches), and that visitor only ever reaches its own data. Anything that changes state must also
 * come from this site's own pages, so another website can't drive someone's browser into using it.
 *
 *     const open = await guardOpen(request);
 *     if (open.denied) return open.denied;
 *     const visitor = open.visitor;
 */
export async function guardOpen(request: Request): Promise<OpenGuard> {
  const visitor = request.headers.get(VISITOR_HEADER) ?? "";
  if (!VISITOR_ID.test(visitor)) {
    return { visitor: null, denied: NextResponse.json({ ok: false, error: "Open the app in your browser first, then try again." }, { status: 401 }) };
  }
  if (!READ_METHODS.has(request.method) && !isSameOrigin(request)) {
    return { visitor: null, denied: NextResponse.json({ ok: false, error: "Cross-site request refused." }, { status: 403 }) };
  }
  return { visitor, denied: null };
}
