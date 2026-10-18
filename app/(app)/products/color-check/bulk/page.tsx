import { BulkVariantForm } from "./BulkVariantForm";
import { getColorLibrary } from "@/lib/shopify/colorLibrary";
import type { ColorLibraryEntry } from "@/components/products/ColorVariantPicker";

export default async function BulkColorVariantPage() {
  let colorLibrary: ColorLibraryEntry[] = [];
  let colorLibraryError: string | null = null;

  try {
    const library = await getColorLibrary();
    if (library) colorLibrary = library.entries;
    else colorLibraryError = 'Couldn\'t find a "Color" metaobject definition in this store.';
  } catch (err) {
    colorLibraryError = err instanceof Error ? err.message : "Couldn't load the color library.";
  }

  return <BulkVariantForm colorLibrary={colorLibrary} colorLibraryError={colorLibraryError} />;
}
