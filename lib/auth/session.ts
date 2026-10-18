import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAuthSecret, normalizeStoreName } from "./accounts";
import { AUTH_COOKIE, AUTH_MAX_AGE_SECONDS } from "./cookie";

export { AUTH_COOKIE };

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: AUTH_MAX_AGE_SECONDS,
};

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Reads the signed session cookie and returns the store it belongs to.
 *
 * The cookie is `<storeName>.<issuedAt>.<hmac>`; the signature is verified
 * here (Node runtime) rather than in the proxy, which only gets to do a cheap
 * presence check on the Edge — so this is the real authentication gate.
 */
export async function getAuthenticatedStore(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(AUTH_COOKIE)?.value;
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator === -1) return null;
  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  const secret = await getAuthSecret();
  if (!signaturesMatch(signature, sign(payload, secret))) return null;

  const dot = payload.lastIndexOf(".");
  if (dot === -1) return null;
  const storeName = payload.slice(0, dot);
  const issuedAt = Number(payload.slice(dot + 1));
  if (!storeName || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > AUTH_MAX_AGE_SECONDS * 1000) return null;

  return storeName;
}

export async function startAuthSession(rawStoreName: string): Promise<void> {
  const storeName = normalizeStoreName(rawStoreName);
  const payload = `${storeName}.${Date.now()}`;
  const secret = await getAuthSecret();
  const jar = await cookies();
  jar.set(AUTH_COOKIE, `${payload}.${sign(payload, secret)}`, COOKIE_OPTIONS);
}

export async function endAuthSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(AUTH_COOKIE);
}
