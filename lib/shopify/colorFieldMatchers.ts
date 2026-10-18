import type { MetaobjectFieldDefinition } from "./metaobjects";

const REFERENCE_TYPES = new Set([
  "list.metaobject_reference",
  "metaobject_reference",
  "list.mixed_reference",
  "mixed_reference",
  // Shopify's standardized product taxonomy attribute values (e.g. the
  // built-in Color/Pattern attribute lists) use their own reference type,
  // distinct from merchant-defined metaobject references.
  "list.product_taxonomy_value_reference",
  "product_taxonomy_value_reference",
]);

export function isReferenceField(f: MetaobjectFieldDefinition): boolean {
  return REFERENCE_TYPES.has(f.typeName);
}

export function isTaxonomyValueField(f: MetaobjectFieldDefinition): boolean {
  return f.typeName === "list.product_taxonomy_value_reference" || f.typeName === "product_taxonomy_value_reference";
}

/**
 * Matches a definition's "base color" / "base pattern" reference fields.
 * Shopify's standard Color taxonomy metaobject uses field keys like
 * `color-taxonomy-reference` / `pattern-taxonomy-reference`, which are
 * checked first since keys are far less likely to vary than the
 * human-readable field name. Name-based matching is kept as a fallback for
 * custom (non-standard) definitions that don't follow that convention.
 */
export function findBaseColorField(
  fields: MetaobjectFieldDefinition[],
): MetaobjectFieldDefinition | undefined {
  const byKey = fields.find(
    (f) => isReferenceField(f) && /color[-_]?taxonomy/i.test(f.key) && !/pattern/i.test(f.key),
  );
  if (byKey) return byKey;
  return fields.find(
    (f) => isReferenceField(f) && /base[\s_-]?color/i.test(f.name),
  );
}

export function findBasePatternField(
  fields: MetaobjectFieldDefinition[],
): MetaobjectFieldDefinition | undefined {
  const byKey = fields.find((f) => isReferenceField(f) && /pattern[-_]?taxonomy/i.test(f.key));
  if (byKey) return byKey;
  return fields.find(
    (f) => isReferenceField(f) && /base[\s_-]?pattern/i.test(f.name),
  );
}

export function findLabelField(
  fields: MetaobjectFieldDefinition[],
): MetaobjectFieldDefinition | undefined {
  return (
    fields.find((f) => f.typeName === "single_line_text_field" && /label/i.test(f.key)) ??
    fields.find((f) => f.typeName === "single_line_text_field")
  );
}

export function findColorField(
  fields: MetaobjectFieldDefinition[],
): MetaobjectFieldDefinition | undefined {
  return fields.find((f) => f.typeName === "color");
}
