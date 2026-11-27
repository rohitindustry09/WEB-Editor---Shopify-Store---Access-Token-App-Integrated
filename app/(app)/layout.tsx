import { AppFrame } from "@/components/nav/AppFrame";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { getOAuthConfig } from "@/lib/shopify/oauth";
import { getShopInfo } from "@/lib/shopify/shop";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Open to everyone: the free tools work without a store, and a page that needs one shows a login popup (see AppFrame).
  // The proxy only sees that a cookie exists; this verifies its signature, so a forged or expired cookie counts as logged out.
  const store = await getAuthenticatedStore();

  let shopName = store ?? "";
  let domain = "";
  if (store) {
    try {
      const shop = await getShopInfo();
      shopName = shop.name;
      domain = shop.myshopifyDomain;
    } catch {
      // Session may be mid-setup or the token may have been revoked — the
      // frame still renders, individual pages surface the real error.
    }
  }

  return (
    <AppFrame shopName={shopName} domain={domain} loggedIn={Boolean(store)} oauthReady={getOAuthConfig() !== null}>
      {children}
    </AppFrame>
  );
}
