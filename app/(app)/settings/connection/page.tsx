import { ConnectionView } from "./ConnectionView";
import { getSession } from "@/lib/shopify/session";
import { fetchGrantedScopes } from "@/lib/shopify/accessScopes";

export default async function SettingsConnectionPage() {
  const session = await getSession();
  // What Shopify says the token can really do; null when it can't be read (the page then falls back to what was chosen at connect time).
  const granted = await fetchGrantedScopes().catch(() => null);
  return <ConnectionView domain={session?.shop ?? ""} scopes={session?.scopes ?? []} grantedScopes={granted} />;
}
