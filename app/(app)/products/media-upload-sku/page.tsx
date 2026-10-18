import { getSession } from "@/lib/shopify/session";
import { getShopInfo } from "@/lib/shopify/shop";
import { MediaUploadBySkuForm } from "./MediaUploadBySkuForm";

export default async function ProductMediaUploadBySkuPage() {
  const session = await getSession();
  let storeName = session?.shop ?? "";
  try {
    storeName = (await getShopInfo()).name;
  } catch {
    // The store name is only a label — the tool works from the connection alone.
  }
  return <MediaUploadBySkuForm storeName={storeName} />;
}
