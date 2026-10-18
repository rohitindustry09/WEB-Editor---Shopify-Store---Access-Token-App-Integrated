import { getSession } from "@/lib/shopify/session";
import { getShopInfo } from "@/lib/shopify/shop";
import { StoreCompareForm } from "./StoreCompareForm";

export default async function StoreComparePage() {
  const session = await getSession();
  let storeName = session?.shop ?? "";
  let currencyCode = "";
  try {
    const shop = await getShopInfo();
    storeName = shop.name;
    currencyCode = shop.currencyCode;
  } catch {
    // The names / currency are conveniences — the tool still works from the domain alone.
  }
  return <StoreCompareForm storeName={storeName} shopDomain={session?.shop ?? ""} currencyCode={currencyCode} />;
}
