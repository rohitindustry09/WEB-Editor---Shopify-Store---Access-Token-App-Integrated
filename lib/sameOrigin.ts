/**
 * True when a state-changing request came from this site's own pages. A request that
 * carries an `Origin` header must name this host; one with no Origin (a same-origin
 * fetch from older browsers, a server-side call) is allowed. A malformed or "null"
 * Origin counts as foreign — it never throws.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
