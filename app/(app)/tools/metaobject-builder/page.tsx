import { fetchGrantedScopes } from "@/lib/shopify/accessScopes";
import { getSession } from "@/lib/shopify/session";
import { MetaobjectBuilder } from "./MetaobjectBuilder";

export default async function MetaobjectBuilderPage() {
  const session = await getSession();
  // What Shopify says the key can do right now; when that can't be read, the scopes saved at connect time; else unknown.
  const granted = await fetchGrantedScopes().catch(() => null);
  const grantedScopes = granted ?? (session && session.scopes.length > 0 ? session.scopes : null);
  return <MetaobjectBuilder grantedScopes={grantedScopes} />;
}
