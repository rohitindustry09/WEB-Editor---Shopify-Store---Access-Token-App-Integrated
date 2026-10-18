import { CategoryCheckView } from "./CategoryCheckView";
import { getProductCategory, getCategoryAttributes } from "@/lib/shopify/taxonomy";
import type { ProductCategory, TaxonomyAttribute } from "@/lib/shopify/taxonomy";

export default async function ColorCheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let productTitle: string | null = null;
  let category: ProductCategory | null = null;
  let categoryError: string | null = null;

  try {
    const result = await getProductCategory(id);
    productTitle = result.title;
    category = result.category;
  } catch (err) {
    categoryError = err instanceof Error ? err.message : "Something went wrong loading the product's category.";
  }

  let attributes: TaxonomyAttribute[] | null = null;
  let attributesError: string | null = null;

  if (category) {
    try {
      attributes = await getCategoryAttributes(category.id);
    } catch (err) {
      attributesError = err instanceof Error ? err.message : "Something went wrong loading category attributes.";
    }
  }

  return (
    <CategoryCheckView
      productId={id}
      productTitle={productTitle}
      category={category}
      categoryError={categoryError}
      attributes={attributes}
      attributesError={attributesError}
    />
  );
}
