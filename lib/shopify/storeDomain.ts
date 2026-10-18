/** A Shopify store, parsed from whatever the visitor typed. */
export interface ParsedShop {
  /** The handle, e.g. `your-store`. */
  name: string;
  /** The full admin host, e.g. `your-store.myshopify.com` — the only host an access key is ever sent to. */
  shop: string;
}

/** Shopify store handles: letters, digits and hyphens, not starting with a hyphen. */
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

/**
 * Accepts `your-store`, `your-store.myshopify.com`, a pasted admin link such as
 * `https://admin.shopify.com/store/your-store/...` or `https://your-store.myshopify.com/admin`, and returns
 * the validated handle. Anything that is not a plain store handle is refused, so a typed value can never
 * steer the access key to another host.
 */
export function parseShopDomain(raw: string): ParsedShop | null {
  let text = raw.trim().toLowerCase().replace(/^https?:\/\//, "");
  const adminLink = /^admin\.shopify\.com\/store\/([^/?#]+)/.exec(text);
  if (adminLink) text = adminLink[1];
  text = text.split(/[/?#]/)[0].replace(/\.myshopify\.com$/, "");
  return HANDLE_PATTERN.test(text) ? { name: text, shop: `${text}.myshopify.com` } : null;
}
