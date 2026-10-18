import "server-only";
import { cookies } from "next/headers";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { SCOPES_COOKIE, SHOP_COOKIE, TOKEN_COOKIE } from "./config";

export interface ShopifySession {
  shop: string;
  token: string;
  scopes: string[];
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export async function getSession(): Promise<ShopifySession | null> {
  // The Shopify cookies are plain values, so they only count for someone who also holds the signed sign-in cookie —
  // this is what keeps every server action and Shopify call behind the real login, not just the proxy's presence check.
  if (!(await getAuthenticatedStore())) return null;
  const store = await cookies();
  const shop = store.get(SHOP_COOKIE)?.value;
  const token = store.get(TOKEN_COOKIE)?.value;
  if (!shop || !token) return null;
  const scopesRaw = store.get(SCOPES_COOKIE)?.value;
  return { shop, token, scopes: scopesRaw ? scopesRaw.split(",") : [] };
}

export async function setSession(session: ShopifySession): Promise<void> {
  const store = await cookies();
  store.set(SHOP_COOKIE, session.shop, COOKIE_OPTIONS);
  store.set(TOKEN_COOKIE, session.token, COOKIE_OPTIONS);
  store.set(SCOPES_COOKIE, session.scopes.join(","), COOKIE_OPTIONS);
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SHOP_COOKIE);
  store.delete(TOKEN_COOKIE);
  store.delete(SCOPES_COOKIE);
}
