/** Product images and the problems the Image fixer looks for. Plain data and pure functions. */

export interface ImageRow {
  fileId: string;
  productId: string;
  productTitle: string;
  vendor: string;
  /** 1-based position among the product's images. */
  position: number;
  alt: string;
  url: string;
  width: number;
  height: number;
}

export type ImageIssue = "missingAlt" | "oversized" | "lowRes";

/** Longest side above which an image is heavier than any storefront needs. */
export const OVERSIZED_PX = 4000;
/** Longest side below which an image looks soft on a product page. */
export const LOW_RES_PX = 800;

export function imageIssues(image: Pick<ImageRow, "alt" | "width" | "height">): ImageIssue[] {
  const issues: ImageIssue[] = [];
  const longest = Math.max(image.width, image.height);
  if (!image.alt.trim()) issues.push("missingAlt");
  if (longest > OVERSIZED_PX) issues.push("oversized");
  if (longest > 0 && longest < LOW_RES_PX) issues.push("lowRes");
  return issues;
}

export type AltTemplate = "title" | "titleVendor" | "titleNumber";

export const ALT_TEMPLATES: { value: AltTemplate; label: string; example: string }[] = [
  { value: "title", label: "Product title", example: "Blue ceramic mug" },
  { value: "titleVendor", label: "Product title – vendor", example: "Blue ceramic mug – Brasstown" },
  { value: "titleNumber", label: "Product title – image number", example: "Blue ceramic mug – image 2" },
];

const MAX_ALT = 500;

export function altTextFor(image: Pick<ImageRow, "productTitle" | "vendor" | "position">, template: AltTemplate): string {
  const title = image.productTitle.trim();
  const text =
    template === "titleVendor" && image.vendor.trim()
      ? `${title} – ${image.vendor.trim()}`
      : template === "titleNumber"
        ? `${title} – image ${image.position}`
        : title;
  return text.slice(0, MAX_ALT);
}
