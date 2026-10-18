import { TagBulkForm } from "./TagBulkForm";
import { getSession } from "@/lib/shopify/session";

export default async function TagBulkPage() {
  const session = await getSession();
  return <TagBulkForm shopDomain={session?.shop ?? ""} />;
}
