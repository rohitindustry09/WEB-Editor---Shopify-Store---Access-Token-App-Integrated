import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { capabilities, scopesFor } from "@/lib/scopes";
import { parseShopDomain } from "./storeDomain";

/**
 * "Connect with Shopify": the standard OAuth install flow (authorization code grant). The visitor types only
 * a store domain, approves the app on Shopify, and Shopify sends back a one-time code that the server swaps for a
 * permanent access token. Nothing here touches the network or cookies except \`exchangeCode\`, so the checks that
 * make the flow safe (the state value and Shopify's signature) are plain functions that can be tested.
 */

export const OAUTH_STATE_COOKIE = "shopify_oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;
const MAX_CALLBACK_AGE_SECONDS = 600;

/** Scopes the newer tools need on top of the wizard's capabilities (metaobject definitions, files, navigation, reports). */
const EXTRA_SCOPES = [
  "read_metaobject_definitions",
  "write_metaobject_definitions",
  "read_metaobjects",
  "write_metaobjects",
  "read_files",
  "write_files",
  "read_online_store_navigation",
  "write_online_store_navigation",
  "read_reports",
];

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

/** The app's credentials from the environment; null when this server isn't set up for it. */
export function getOAuthConfig(): OAuthConfig | null {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const fromEnv = process.env.SHOPIFY_SCOPES?.split(",").map((scope) => scope.trim()).filter(Boolean);
  const scopes = fromEnv && fromEnv.length > 0 ? fromEnv : [...new Set([...scopesFor(capabilities.map((capability) => capability.id)), ...EXTRA_SCOPES])];
  return { clientId, clientSecret, scopes };
}

/** This site's public address: APP_URL when set (use it behind a proxy), else the address the request came in on. */
export function appBaseUrl(requestUrl: string): string {
  return process.env.APP_URL?.trim().replace(/\/+$/, "") || new URL(requestUrl).origin;
}

/** The address Shopify sends the visitor back to; it must be listed in the app's allowed redirection URLs. */
export function callbackUrl(requestUrl: string): string {
  return `${appBaseUrl(requestUrl)}/api/auth/shopify/callback`;
}

export const newState = (): string => randomBytes(16).toString("hex");

/** The Shopify page that asks the merchant to approve the app. */
export function buildAuthorizeUrl(config: OAuthConfig, shop: string, redirectUri: string, state: string): string {
  const query = new URLSearchParams({ client_id: config.clientId, scope: config.scopes.join(","), redirect_uri: redirectUri, state });
  return `https://${shop}/admin/oauth/authorize?${query.toString()}`;
}

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Shopify signs the callback's query string: every parameter except \`hmac\`, sorted by name and joined as
 * \`name=value&…\`, signed with the app's secret (hex SHA-256). A request that wasn't made by Shopify can't carry a valid one.
 */
export function hasValidSignature(params: URLSearchParams, clientSecret: string): boolean {
  const given = params.get("hmac");
  if (!given) return false;
  const message = [...params.entries()]
    .filter(([name]) => name !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return safeEqual(createHmac("sha256", clientSecret).update(message).digest("hex"), given);
}

export type CallbackCheck = { ok: true; shop: string; code: string } | { ok: false; error: string };

/**
 * Everything the callback must prove before its code is trusted: Shopify's signature, the state value this
 * browser was given when it started (so the flow wasn't begun by someone else), the shop we sent it to, and freshness.
 */
export function checkCallback(params: URLSearchParams, cookie: { state: string; shop: string } | null, clientSecret: string, nowSeconds = Math.floor(Date.now() / 1000)): CallbackCheck {
  if (!hasValidSignature(params, clientSecret)) return { ok: false, error: "Shopify's reply couldn't be verified, so it was ignored." };
  if (!cookie) return { ok: false, error: "This sign-in attempt expired or didn't start here. Start again." };
  const state = params.get("state") ?? "";
  if (!state || !safeEqual(state, cookie.state)) return { ok: false, error: "This sign-in attempt doesn't match the one you started. Start again." };
  const parsed = parseShopDomain(params.get("shop") ?? "");
  if (!parsed || parsed.shop !== cookie.shop) return { ok: false, error: "Shopify answered for a different store than the one you chose." };
  const timestamp = Number(params.get("timestamp"));
  if (Number.isFinite(timestamp) && timestamp > 0 && Math.abs(nowSeconds - timestamp) > MAX_CALLBACK_AGE_SECONDS) return { ok: false, error: "That Shopify reply is too old. Start again." };
  const code = params.get("code") ?? "";
  if (!code) return { ok: false, error: "Shopify didn't send an approval code — the app may not have been installed." };
  return { ok: true, shop: parsed.shop, code };
}

export interface ExchangedToken {
  accessToken: string;
  scopes: string[];
}

/** Swaps the one-time code for the store's permanent (offline) access token. */
export async function exchangeCode(config: OAuthConfig, shop: string, code: string): Promise<ExchangedToken> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; scope?: string; error_description?: string; error?: string } | null;
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.error_description ?? body?.error ?? `Shopify refused the approval code (${response.status}).`);
  }
  return { accessToken: body.access_token, scopes: (body.scope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean) };
}
