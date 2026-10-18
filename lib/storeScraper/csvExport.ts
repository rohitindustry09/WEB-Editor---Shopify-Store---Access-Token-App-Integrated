import { buildCsv } from "@/lib/csvExport";
import { filterCustomFields } from "./customFields";
import type { ScrapedProduct } from "./types";

const HEADER = [
  "Platform",
  "Product ID",
  "Name",
  "URL",
  "SKU",
  "Price",
  "Compare At Price",
  "Currency",
  "Availability",
  "Stock",
  "Vendor",
  "Categories",
  "Tags",
  "Description",
  "Image Count",
  "Images",
  "Video Count",
  "Videos",
  "Custom Fields",
];

/** Generic per-job CSV — one row per product, every scraped field, custom fields joined into a single cell. */
export function buildScrapedProductsCsv(products: ScrapedProduct[], requestedFields: string[]): string {
  const rows = products.map((product) => {
    const customFields = filterCustomFields(product.customFields, requestedFields);
    return [
      product.platform,
      product.productId,
      product.name,
      product.url,
      product.sku ?? "",
      product.price !== null ? String(product.price) : "",
      product.compareAtPrice !== null ? String(product.compareAtPrice) : "",
      product.currency ?? "",
      product.availability ?? "",
      product.isOutOfStock === null ? "" : product.isOutOfStock ? "Out of stock" : "In stock",
      product.vendor ?? "",
      product.categories.join(", "),
      product.tags.join(", "),
      product.descriptionHtml ?? "",
      String(product.images.length),
      product.images.join(", "),
      String(product.videos.length),
      product.videos.join(", "),
      customFields.map((f) => `${f.label}: ${f.value}`).join("\n"),
    ];
  });
  return buildCsv(HEADER, rows);
}
