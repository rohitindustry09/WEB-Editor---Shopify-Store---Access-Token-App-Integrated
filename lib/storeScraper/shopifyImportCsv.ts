import { buildCsv } from "@/lib/csvExport";
import { filterCustomFields } from "./customFields";
import type { ScrapedProduct } from "./types";

/** Shopify's own hard limit on images per product — reflected in a real `products_export.csv`. */
const MAX_IMAGES_PER_PRODUCT = 250;

const HEADER = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Variant Barcode",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "Gift Card",
  "SEO Title",
  "SEO Description",
  "Variant Weight Unit",
  "Status",
  "Additional Details (product.metafields.custom.additional_details)",
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}

function deriveHandle(product: ScrapedProduct): string {
  try {
    const url = new URL(product.url);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    if (lastSegment) return slugify(lastSegment.replace(/\.html$/, ""));
  } catch {
    // fall through to title-derived handle
  }
  return slugify(product.name) || product.productId;
}

function money(value: number | null): string {
  return value !== null && Number.isFinite(value) ? value.toFixed(2) : "";
}

/**
 * Reproduces Shopify's real product import column layout: one main row per
 * product carrying every field, plus one continuation row per extra image
 * (Shopify's own format for a multi-image product — only `Handle`,
 * `Image Src`, and `Image Position` are populated on those rows).
 *
 * `Additional Details` maps every captured custom field into one cell as
 * `Label: value` lines — importing this column requires a matching Shopify
 * metafield definition first (namespace `custom`, key `additional_details`,
 * type "Multi-line text").
 */
export function buildShopifyImportCsv(products: ScrapedProduct[], requestedFields: string[]): { csv: string; cappedProductCount: number } {
  const rows: string[][] = [];
  let cappedProductCount = 0;

  for (const product of products) {
    const handle = deriveHandle(product);
    const images = product.images.slice(0, MAX_IMAGES_PER_PRODUCT);
    if (product.images.length > MAX_IMAGES_PER_PRODUCT) cappedProductCount += 1;

    const tags = (product.tags.length > 0 ? product.tags : product.categories).join(", ");
    const customFields = filterCustomFields(product.customFields, requestedFields);
    const additionalDetails = customFields.map((f) => `${f.label}: ${f.value}`).join("\n");

    rows.push([
      handle,
      product.name,
      product.descriptionHtml ?? "",
      product.vendor ?? "",
      "",
      product.categories[0] ?? "",
      tags,
      "true",
      "Title",
      "Default Title",
      product.sku ?? "",
      "0.0",
      "shopify",
      "",
      "deny",
      "manual",
      money(product.price),
      money(product.compareAtPrice),
      "true",
      "true",
      "",
      images[0] ?? "",
      images[0] ? "1" : "",
      "",
      "false",
      "",
      "",
      "kg",
      "active",
      additionalDetails,
    ]);

    for (let i = 1; i < images.length; i++) {
      const continuationRow = new Array(HEADER.length).fill("");
      continuationRow[0] = handle;
      continuationRow[21] = images[i];
      continuationRow[22] = String(i + 1);
      rows.push(continuationRow);
    }
  }

  return { csv: buildCsv(HEADER, rows), cappedProductCount };
}
