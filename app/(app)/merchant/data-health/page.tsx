import { getSession } from "@/lib/shopify/session";
import { DataHealth } from "./DataHealth";

export default async function DataHealthPage() {
  const session = await getSession();
  return <DataHealth shopDomain={session?.shop ?? ""} />;
}
