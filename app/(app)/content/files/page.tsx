import { FilesView } from "./FilesView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import { getStoreFiles, type StoreFile } from "@/lib/shopify/files";

export default async function FilesPage() {
  let files: StoreFile[] = [];
  let error: string | null = null;

  try {
    files = await getStoreFiles();
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading files.";
  }

  return <FilesView files={files} error={error} />;
}
