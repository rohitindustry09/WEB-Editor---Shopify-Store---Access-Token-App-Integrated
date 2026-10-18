import { MetaobjectsView } from "./MetaobjectsView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getMetaobjectDefinitions } from "@/lib/shopify/metaobjects";
import type { MetaobjectDefinitionSummary } from "@/lib/shopify/metaobjects";

export default async function MetaobjectsPage() {
  let definitions: MetaobjectDefinitionSummary[] = [];
  let error: string | null = null;

  try {
    definitions = await getMetaobjectDefinitions();
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading metaobject definitions.";
  }

  return <MetaobjectsView definitions={definitions} error={error} />;
}
