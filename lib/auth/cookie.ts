/**
 * Cookie name only — kept free of `server-only` and Node imports so the Edge
 * proxy can read it without pulling in the crypto-backed session module.
 */
export const AUTH_COOKIE = "bt_auth";

export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
