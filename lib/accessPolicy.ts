/**
 * Which parts of the app need a connected Shopify store and which are free to use. The free tools never touch the store, so they
 * work for anyone who opens the app; everything else shows a login popup until a store is connected. Pure data, shared by the
 * proxy, the server and the browser.
 */

/** Pages anyone can use without logging in. */
export const OPEN_PAGE_PREFIXES = ["/tools/bg-customiser", "/tools/bg-remover", "/tools/media-converter", "/tools/seo-audit", "/bg-customiser-grid"] as const;

/** APIs behind those tools. They don't need a store, but each browser only ever sees its own data (see `visitor` below). */
export const OPEN_API_PREFIXES = ["/api/bg-customiser", "/api/bg-jobs", "/api/bg-uploads", "/api/bg-workspace", "/api/gdrive", "/api/media-converter", "/api/seo-audit"] as const;

const matches = (pathname: string, prefixes: readonly string[]): boolean => prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export const isOpenPage = (pathname: string): boolean => matches(pathname, OPEN_PAGE_PREFIXES);
export const isOpenApi = (pathname: string): boolean => matches(pathname, OPEN_API_PREFIXES);

/** Pages that must stay reachable for everyone, whatever the login state (the login wizard, the "please log in" page, the framework's own files). */
export const isPublicPage = (pathname: string): boolean =>
  pathname === "/" || pathname === "/connect" || pathname.startsWith("/connect/") || pathname === "/login-required" || pathname.startsWith("/api/");

// --- Anonymous visitors: the free tools need no account, so each browser gets a random ID that its data is filed under. ---

export const VISITOR_COOKIE = "bt_visitor";
/** Set by the proxy on every request (overwriting anything the client sent), so server code can trust it. */
export const VISITOR_HEADER = "x-visitor-id";
export const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const VISITOR_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
