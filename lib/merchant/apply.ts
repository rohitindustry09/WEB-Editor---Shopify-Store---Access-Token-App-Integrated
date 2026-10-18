import { shopifyGraphQL } from "@/lib/shopify/client";
import { updateProduct } from "@/lib/shopify/products";
import type { UserError } from "@/lib/shopify/types";
import type { ApplyItem, ApplyOutcome } from "./types";

/** Server-side validation and application of one Merchant Tools change. */

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const FILE_GID = /^gid:\/\/shopify\/MediaImage\/\d+$/;
const REDIRECT_GID = /^gid:\/\/shopify\/UrlRedirect\/\d+$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const MAX_ALT = 512;
const MAX_SEO_TITLE = 255;
const MAX_SEO_DESCRIPTION = 512;
const MAX_PATH = 1000;
const MAX_VARIANTS_PER_CALL = 100;
const MAX_FILES_PER_CALL = 25;

const errorText = (errors: UserError[]): string => errors.map((error) => error.message).join("; ");
const messageOf = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

const VARIANTS_MUTATION = `
  mutation MerchantVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

const FILE_UPDATE_MUTATION = `
  mutation MerchantFileAlt($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id }
      userErrors { field message }
    }
  }
`;

const REDIRECT_CREATE_MUTATION = `
  mutation MerchantRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect { id }
      userErrors { field message }
    }
  }
`;

const REDIRECT_DELETE_MUTATION = `
  mutation MerchantRedirectDelete($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
      userErrors { field message }
    }
  }
`;

const validRedirectPart = (value: string): boolean => value.length > 0 && value.length <= MAX_PATH && !/\s/.test(value);

async function applyVariantPrices(item: Extract<ApplyItem, { kind: "variantPrice" }>): Promise<ApplyOutcome> {
  if (!PRODUCT_GID.test(item.productId)) return { ok: false, error: "Invalid product id." };
  if (!Array.isArray(item.variants) || item.variants.length === 0 || item.variants.length > MAX_VARIANTS_PER_CALL) return { ok: false, error: "Invalid variant list." };
  const variants: Record<string, unknown>[] = [];
  for (const variant of item.variants) {
    if (typeof variant?.id !== "string" || !VARIANT_GID.test(variant.id)) return { ok: false, error: "Invalid variant id." };
    const input: Record<string, unknown> = { id: variant.id };
    if (variant.price !== undefined) {
      if (typeof variant.price !== "string" || !MONEY.test(variant.price)) return { ok: false, error: `"${String(variant.price)}" isn't a valid price.` };
      input.price = variant.price;
    }
    if (variant.compareAtPrice !== undefined) {
      if (variant.compareAtPrice !== null && (typeof variant.compareAtPrice !== "string" || !MONEY.test(variant.compareAtPrice))) {
        return { ok: false, error: `"${String(variant.compareAtPrice)}" isn't a valid compare-at price.` };
      }
      input.compareAtPrice = variant.compareAtPrice;
    }
    variants.push(input);
  }
  const data = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: UserError[] } }>(VARIANTS_MUTATION, { productId: item.productId, variants });
  const errors = data.productVariantsBulkUpdate.userErrors;
  return errors.length > 0 ? { ok: false, error: errorText(errors) } : { ok: true };
}

async function applyMediaAlt(item: Extract<ApplyItem, { kind: "mediaAlt" }>): Promise<ApplyOutcome> {
  if (!Array.isArray(item.files) || item.files.length === 0 || item.files.length > MAX_FILES_PER_CALL) return { ok: false, error: "Invalid file list." };
  for (const file of item.files) {
    if (typeof file?.id !== "string" || !FILE_GID.test(file.id)) return { ok: false, error: "Invalid image id." };
    if (typeof file.alt !== "string" || file.alt.length > MAX_ALT) return { ok: false, error: "Alt text must be 512 characters or fewer." };
  }
  const data = await shopifyGraphQL<{ fileUpdate: { userErrors: UserError[] } }>(FILE_UPDATE_MUTATION, { files: item.files.map((file) => ({ id: file.id, alt: file.alt })) });
  const errors = data.fileUpdate.userErrors;
  return errors.length > 0 ? { ok: false, error: errorText(errors) } : { ok: true };
}

async function applyProductSeo(item: Extract<ApplyItem, { kind: "productSeo" }>): Promise<ApplyOutcome> {
  if (!PRODUCT_GID.test(item.productId)) return { ok: false, error: "Invalid product id." };
  const { title, description } = item.seo ?? {};
  if ((title !== undefined && (typeof title !== "string" || title.length > MAX_SEO_TITLE)) || (description !== undefined && (typeof description !== "string" || description.length > MAX_SEO_DESCRIPTION))) {
    return { ok: false, error: "SEO text is too long." };
  }
  const errors = await updateProduct({ id: item.productId, seo: { ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}) } });
  return errors.length > 0 ? { ok: false, error: errorText(errors) } : { ok: true };
}

async function createRedirect(item: Extract<ApplyItem, { kind: "redirectCreate" }>): Promise<ApplyOutcome> {
  if (typeof item.path !== "string" || typeof item.target !== "string" || !item.path.startsWith("/") || !validRedirectPart(item.path) || !validRedirectPart(item.target)) {
    return { ok: false, error: "A redirect needs a path starting with / and a target with no spaces." };
  }
  const data = await shopifyGraphQL<{ urlRedirectCreate: { urlRedirect: { id: string } | null; userErrors: UserError[] } }>(REDIRECT_CREATE_MUTATION, {
    urlRedirect: { path: item.path, target: item.target },
  });
  const { urlRedirect, userErrors } = data.urlRedirectCreate;
  if (userErrors.length > 0 || !urlRedirect) return { ok: false, error: errorText(userErrors) || "Shopify didn't create the redirect." };
  return { ok: true, createdId: urlRedirect.id };
}

async function deleteRedirect(item: Extract<ApplyItem, { kind: "redirectDelete" }>): Promise<ApplyOutcome> {
  if (typeof item.id !== "string" || !REDIRECT_GID.test(item.id)) return { ok: false, error: "Invalid redirect id." };
  const data = await shopifyGraphQL<{ urlRedirectDelete: { userErrors: UserError[] } }>(REDIRECT_DELETE_MUTATION, { id: item.id });
  const errors = data.urlRedirectDelete.userErrors;
  return errors.length > 0 ? { ok: false, error: errorText(errors) } : { ok: true };
}

const MAX_ATTEMPTS = 4;
const RATE_LIMIT = /throttl|rate limit|429|50[23]/i;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function applyOnce(item: ApplyItem): Promise<ApplyOutcome> {
  try {
    switch (item?.kind) {
      case "variantPrice":
        return await applyVariantPrices(item);
      case "mediaAlt":
        return await applyMediaAlt(item);
      case "productSeo":
        return await applyProductSeo(item);
      case "redirectCreate":
        return await createRedirect(item);
      case "redirectDelete":
        return await deleteRedirect(item);
      default:
        return { ok: false, error: "Unknown change." };
    }
  } catch (err) {
    return { ok: false, error: messageOf(err, "The change couldn't be saved.") };
  }
}

/** Applies one change, retrying with backoff while Shopify says "slow down". */
export async function applyMerchantItem(item: ApplyItem): Promise<ApplyOutcome> {
  let outcome = await applyOnce(item);
  for (let attempt = 1; attempt < MAX_ATTEMPTS && !outcome.ok && RATE_LIMIT.test(outcome.error ?? ""); attempt++) {
    await wait(600 * 2 ** attempt);
    outcome = await applyOnce(item);
  }
  return outcome;
}
