import { getSession } from "@/lib/shopify/session";
import { getShopInfo } from "@/lib/shopify/shop";
import { UploadProductsForm } from "./UploadProductsForm";

export default async function UploadProductsPage() {
  const session = await getSession();
  let storeName = session?.shop ?? "";
  try {
    storeName = (await getShopInfo()).name;
  } catch {
    // Falls back to the domain — the connected-store label is a nicety, not required to use the tool.
  }
  return <UploadProductsForm storeName={storeName} shopDomain={session?.shop ?? ""} />;
}
