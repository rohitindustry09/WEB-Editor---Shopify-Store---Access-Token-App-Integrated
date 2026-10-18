import { shopifyGraphQL } from "./client";
import type { UserError } from "./types";

const PRODUCT_OPTIONS_CREATE_MUTATION = `
  mutation ProductOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options) {
      product { id }
      userErrors { field message code }
    }
  }
`;

const PRODUCT_OPTION_UPDATE_MUTATION = `
  mutation ProductOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $optionValuesToAdd: [OptionValueCreateInput!]) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToAdd: $optionValuesToAdd) {
      product { id }
      userErrors { field message code }
    }
  }
`;

export interface ColorOptionValue {
  id: string;
  name: string;
}

export interface ExistingColorValue {
  name: string;
  hex: string | null;
}

export interface ExistingColorValueWithId extends ExistingColorValue {
  id: string;
}

const EXISTING_COLOR_OPTION_QUERY = `
  query ExistingColorOption($id: ID!) {
    product(id: $id) {
      options {
        id
        name
        optionValues {
          id
          name
          swatch { color }
        }
      }
    }
  }
`;

async function fetchColorOption(
  productId: string,
): Promise<{ optionId: string; values: ExistingColorValueWithId[] } | null> {
  const data = await shopifyGraphQL<{
    product: {
      options: {
        id: string;
        name: string;
        optionValues: { id: string; name: string; swatch: { color: string | null } | null }[];
      }[];
    } | null;
  }>(EXISTING_COLOR_OPTION_QUERY, { id: productId });
  const colorOption = data.product?.options.find((o) => o.name.toLowerCase() === "color");
  if (!colorOption) return null;
  return {
    optionId: colorOption.id,
    values: colorOption.optionValues.map((v) => ({ id: v.id, name: v.name, hex: v.swatch?.color ?? null })),
  };
}

/** Reads whatever "Color" option values a product already has, for display — best-effort, never throws. */
export async function getExistingColorOption(productId: string): Promise<ExistingColorValue[]> {
  try {
    const option = await fetchColorOption(productId);
    return option?.values ?? [];
  } catch {
    return [];
  }
}

/** Same as getExistingColorOption but keeps each value's ID, needed to target values for removal. */
export async function getExistingColorOptionWithIds(productId: string): Promise<ExistingColorValueWithId[]> {
  try {
    const option = await fetchColorOption(productId);
    return option?.values ?? [];
  } catch {
    return [];
  }
}

const PRODUCT_OPTION_VALUES_PARTIAL_DELETE_MUTATION = `
  mutation ProductOptionValuesPartialDelete($productId: ID!, $optionId: ID!, $optionValueIds: [ID!]!) {
    productOptionUpdate(productId: $productId, option: { id: $optionId }, optionValuesToDelete: $optionValueIds) {
      product { id }
      userErrors { field message code }
    }
  }
`;

const PRODUCT_OPTIONS_DELETE_MUTATION = `
  mutation ProductOptionsDelete($productId: ID!, $optionId: ID!) {
    productOptionsDelete(productId: $productId, options: [$optionId]) {
      product { id }
      userErrors { field message code }
    }
  }
`;

/**
 * Removes the given Color option values (by name) from a product. If that
 * removes every value the option had, the whole "Color" option — and with
 * it the variants that depended on it — is deleted too, mirroring what
 * happens when a merchant manually clears the last value in Shopify admin.
 */
export async function removeColorOptionValues(
  productId: string,
  colorNames: string[],
): Promise<{ ok: boolean; removed: string[]; notFound: string[]; error?: string }> {
  const requested = new Set(colorNames.map((n) => n.trim().toLowerCase()));

  const option = await fetchColorOption(productId);
  if (!option || option.values.length === 0) {
    return { ok: false, removed: [], notFound: colorNames, error: "This product has no Color option to remove from." };
  }

  const toRemove = option.values.filter((v) => requested.has(v.name.trim().toLowerCase()));
  const notFound = colorNames.filter((n) => !option.values.some((v) => v.name.trim().toLowerCase() === n.trim().toLowerCase()));

  if (toRemove.length === 0) {
    return { ok: false, removed: [], notFound, error: "None of these colors are currently on this product." };
  }

  const removesEverything = toRemove.length === option.values.length;

  if (removesEverything) {
    const data = await shopifyGraphQL<{
      productOptionsDelete: { product: { id: string } | null; userErrors: UserError[] };
    }>(PRODUCT_OPTIONS_DELETE_MUTATION, { productId, optionId: option.optionId });
    const errors = data.productOptionsDelete.userErrors;
    if (errors.length > 0) {
      return { ok: false, removed: [], notFound, error: errors.map((e) => e.message).join("; ") };
    }
    return { ok: true, removed: toRemove.map((v) => v.name), notFound };
  }

  const data = await shopifyGraphQL<{
    productOptionUpdate: { product: { id: string } | null; userErrors: UserError[] };
  }>(PRODUCT_OPTION_VALUES_PARTIAL_DELETE_MUTATION, {
    productId,
    optionId: option.optionId,
    optionValueIds: toRemove.map((v) => v.id),
  });
  const errors = data.productOptionUpdate.userErrors;
  if (errors.length > 0) {
    return { ok: false, removed: [], notFound, error: errors.map((e) => e.message).join("; ") };
  }
  return { ok: true, removed: toRemove.map((v) => v.name), notFound };
}

const METAFIELDS_SET_MUTATION = `
  mutation ColorPatternMetafieldSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;

/**
 * Adds a "Color" variant option to a product, linking each value to an
 * entry in the store's Color metaobject library so it renders with the same
 * swatches Shopify's own admin shows.
 *
 * Real schema constraints discovered from live error text, in the order
 * they were found:
 * 1. `productOptionsCreate` can't take `linkedMetafield` and `values`
 *    together — "Cannot combine linked metafield and option values."
 * 2. But `linkedMetafield` alone, with no values, also fails when the
 *    product's own `shopify.color-pattern` metafield is empty — "The
 *    '...' metafield has no values and none were passed in for this
 *    linked option." A linked option's initial values come from that
 *    metafield already being populated, not from the create call.
 * So the metafield is written first via `metafieldsSet`, THEN the option
 * is created with `linkedMetafield` only — Shopify picks up the values
 * that are now sitting on the metafield.
 * 3. A product can only have one option named "Color" — if it already has
 *    one, creating another fails with "Option 'Color' already exists."
 *    Existing options are checked first; only genuinely new colors are
 *    added via `productOptionUpdate` in that case.
 */
export async function addColorOption(
  productId: string,
  colors: ColorOptionValue[],
): Promise<{ ok: boolean; error?: string; alreadyPresent?: string[] }> {
  const existing = await fetchColorOption(productId);

  const existingNames = new Set((existing?.values ?? []).map((v) => v.name.trim().toLowerCase()));
  const newColors = colors.filter((c) => !existingNames.has(c.name.trim().toLowerCase()));
  const alreadyPresent = colors.filter((c) => existingNames.has(c.name.trim().toLowerCase())).map((c) => c.name);

  if (newColors.length === 0) {
    return { ok: true, alreadyPresent };
  }

  if (existing) {
    const updateData = await shopifyGraphQL<{
      productOptionUpdate: {
        product: { id: string } | null;
        userErrors: UserError[];
      };
    }>(PRODUCT_OPTION_UPDATE_MUTATION, {
      productId,
      option: { id: existing.optionId },
      optionValuesToAdd: newColors.map((c) => ({ linkedMetafieldValue: c.id })),
    });

    const updateErrors = updateData.productOptionUpdate.userErrors;
    if (updateErrors.length > 0) {
      return { ok: false, error: updateErrors.map((e) => e.message).join("; ") };
    }
    if (!updateData.productOptionUpdate.product) {
      return { ok: false, error: "Shopify didn't confirm the values were added." };
    }
    return { ok: true, alreadyPresent };
  }

  const metafieldData = await shopifyGraphQL<{
    metafieldsSet: {
      metafields: { id: string }[] | null;
      userErrors: UserError[];
    };
  }>(METAFIELDS_SET_MUTATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: "shopify",
        key: "color-pattern",
        type: "list.metaobject_reference",
        value: JSON.stringify(newColors.map((c) => c.id)),
      },
    ],
  });

  const metafieldErrors = metafieldData.metafieldsSet.userErrors;
  if (metafieldErrors.length > 0) {
    return { ok: false, error: metafieldErrors.map((e) => e.message).join("; ") };
  }

  const createData = await shopifyGraphQL<{
    productOptionsCreate: {
      product: { id: string } | null;
      userErrors: UserError[];
    };
  }>(PRODUCT_OPTIONS_CREATE_MUTATION, {
    productId,
    options: [
      {
        name: "Color",
        linkedMetafield: { namespace: "shopify", key: "color-pattern" },
      },
    ],
  });

  const createErrors = createData.productOptionsCreate.userErrors;
  if (createErrors.length > 0) {
    return { ok: false, error: createErrors.map((e) => e.message).join("; ") };
  }
  if (!createData.productOptionsCreate.product) {
    return { ok: false, error: "Shopify didn't return the updated product after creating the option." };
  }

  return { ok: true, alreadyPresent };
}
