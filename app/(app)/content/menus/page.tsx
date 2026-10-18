import { MenusView } from "./MenusView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getMenus, type MenuSummary } from "@/lib/shopify/menus";

export default async function MenusPage() {
  let menus: MenuSummary[] = [];
  let error: string | null = null;

  try {
    menus = await getMenus();
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading menus.";
  }

  return <MenusView menus={menus} error={error} />;
}
