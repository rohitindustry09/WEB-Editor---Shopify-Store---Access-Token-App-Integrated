import { getSession } from "@/lib/shopify/session";
import { SmartCollections } from "./SmartCollections";

export default async function SmartCollectionsPage() {
  const session = await getSession();
  return <SmartCollections shopDomain={session?.shop ?? ""} />;
}
