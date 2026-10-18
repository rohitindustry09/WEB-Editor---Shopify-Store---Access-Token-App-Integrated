import { SkuColorCheckView, type SkuCheckResult } from "./SkuColorCheckView";
import { getCategoryAttributes, searchProductsBySku } from "@/lib/shopify/taxonomy";
import { getColorLibrary } from "@/lib/shopify/colorLibrary";
import { getExistingColorOption } from "@/lib/shopify/productOptions";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import type { ColorLibraryEntry } from "@/components/products/ColorVariantPicker";

export default async function ProductsColorCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  const { sku = "" } = await searchParams;
  const searched = sku.trim().length > 0;

  let results: SkuCheckResult[] = [];
  let error: string | null = null;
  let colorLibrary: ColorLibraryEntry[] = [];
  let colorLibraryError: string | null = null;

  try {
    const library = await getColorLibrary();
    if (library) colorLibrary = library.entries;
    else colorLibraryError = 'Couldn\'t find a "Color" metaobject definition in this store.';
  } catch (err) {
    colorLibraryError = err instanceof Error ? err.message : "Couldn't load the color library.";
  }

  if (searched) {
    try {
      const matches = await searchProductsBySku(sku);

      const attributesByCategoryId = new Map<string, { hasColor: boolean; error: string | null }>();
      for (const match of matches) {
        const categoryId = match.category?.id;
        if (!categoryId || attributesByCategoryId.has(categoryId)) continue;
        try {
          const attributes = await getCategoryAttributes(categoryId);
          attributesByCategoryId.set(categoryId, {
            hasColor: attributes.some((a) => a.name.toLowerCase() === "color"),
            error: null,
          });
        } catch (err) {
          attributesByCategoryId.set(categoryId, {
            hasColor: false,
            error: err instanceof Error ? err.message : "Couldn't load category attributes.",
          });
        }
      }

      results = await Promise.all(
        matches.map(async (match) => {
          const resolved = match.category ? attributesByCategoryId.get(match.category.id) : undefined;
          return {
            id: match.id,
            title: match.title,
            sku: match.sku,
            imageUrl: match.image?.url ?? null,
            categoryName: match.category?.fullName ?? null,
            hasColor: match.category ? (resolved?.error ? null : (resolved?.hasColor ?? null)) : null,
            error: resolved?.error ?? null,
            existingColors: await getExistingColorOption(match.id),
          };
        }),
      );
    } catch (err) {
      error =
        err instanceof ShopifyNotConnectedError
          ? "Not connected to a Shopify store yet."
          : err instanceof ShopifyAPIError
            ? err.message
            : "Something went wrong searching by SKU.";
    }
  }

  return (
    <SkuColorCheckView
      sku={sku}
      results={results}
      searched={searched}
      error={error}
      colorLibrary={colorLibrary}
      colorLibraryError={colorLibraryError}
    />
  );
}
