import { SeoAuditForm } from "./SeoAuditForm";
import { getSession } from "@/lib/shopify/session";

export default async function SeoAuditPage() {
  const session = await getSession();
  return <SeoAuditForm defaultDomain={session?.shop ?? ""} />;
}
