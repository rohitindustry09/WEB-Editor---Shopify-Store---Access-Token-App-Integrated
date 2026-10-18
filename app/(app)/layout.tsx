import { redirect } from "next/navigation";
import { AppFrame } from "@/components/nav/AppFrame";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { getShopInfo } from "@/lib/shopify/shop";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy only sees that a cookie exists; this verifies its signature, so
  // a forged or expired cookie can't reach any store data.
  const store = await getAuthenticatedStore();
  if (!store) redirect("/connect");

  let shopName = store;
  let domain = "";
  try {
    const shop = await getShopInfo();
    shopName = shop.name;
    domain = shop.myshopifyDomain;
  } catch {
    // Session may be mid-setup or the token may have been revoked — the
    // frame still renders, individual pages surface the real error.
  }

  return (
    <AppFrame shopName={shopName} domain={domain}>
      {children}
    </AppFrame>
  );
}
