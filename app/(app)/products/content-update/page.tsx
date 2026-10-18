import { ProductContentUpdateForm } from "./ProductContentUpdateForm";
import { getSession } from "@/lib/shopify/session";

export default async function ProductContentUpdatePage() {
  const session = await getSession();
  return <ProductContentUpdateForm shopDomain={session?.shop ?? ""} />;
}
