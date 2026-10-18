"use server";

import { revalidatePath } from "next/cache";
import {
  createMetaobjectEntry,
  getAllMetaobjectEntries,
  getMetaobjectDefinition,
  getMetaobjectDefinitions,
  resolveReferenceLabels,
  type MetaobjectDefinitionSummary,
  type MetaobjectEntry,
  type MetaobjectFieldDefinition,
} from "@/lib/shopify/metaobjects";
import {
  findBaseColorField,
  findBasePatternField,
  findColorField,
  findLabelField,
  isTaxonomyValueField,
} from "@/lib/shopify/colorFieldMatchers";

export interface CreateEntryState {
  ok: boolean;
  error?: string;
}

export async function createEntryAction(
  type: string,
  fields: { key: string; value: string }[],
): Promise<CreateEntryState> {
  try {
    const result = await createMetaobjectEntry(type, fields.filter((f) => f.value !== ""));
    if (result.userErrors.length > 0) {
      return { ok: false, error: result.userErrors.map((e) => e.message).join("; ") };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't create entry." };
  }
  revalidatePath(`/content/metaobjects/${encodeURIComponent(type)}`);
  return { ok: true };
}

function fieldValueIds(entry: MetaobjectEntry, fieldKey: string): string[] {
  const raw = entry.fields.find((f) => f.key === fieldKey)?.value;
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [raw];
}

/**
 * Builds a display-name -> id lookup across every metaobject definition a
 * reference field is allowed to target (a field can allow more than one).
 * Only applies to merchant-defined metaobject_reference fields.
 */
async function buildMetaobjectReferenceMap(
  field: MetaobjectFieldDefinition,
  allDefinitions: MetaobjectDefinitionSummary[],
): Promise<Map<string, string> | null> {
  if (field.referencedDefinitionIds.length === 0) return null;
  const targets = allDefinitions.filter((d) => field.referencedDefinitionIds.includes(d.id));
  if (targets.length === 0) return null;

  const map = new Map<string, string>();
  for (const target of targets) {
    const entries = await getAllMetaobjectEntries(target.type);
    for (const entry of entries) map.set(entry.displayName.trim().toLowerCase(), entry.id);
  }
  return map;
}

/**
 * Shopify's standardized product-taxonomy attribute values (product_taxonomy_value_reference
 * fields — used by the built-in Color/Pattern taxonomy) aren't listable or
 * searchable by name through the Admin API. Instead, this reverse-resolves a
 * name -> id map from whatever values are already in use on this
 * definition's existing entries, which covers every standard value already
 * represented in the store.
 */
async function buildTaxonomyValueMap(
  field: MetaobjectFieldDefinition,
  existingEntries: MetaobjectEntry[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const entry of existingEntries) {
    for (const id of fieldValueIds(entry, field.key)) ids.add(id);
  }
  if (ids.size === 0) return new Map();

  const labels = await resolveReferenceLabels(Array.from(ids));
  const map = new Map<string, string>();
  for (const [gid, label] of labels) map.set(label.trim().toLowerCase(), gid);
  return map;
}

async function buildReferenceMap(
  field: MetaobjectFieldDefinition | undefined,
  allDefinitions: MetaobjectDefinitionSummary[],
  existingEntries: MetaobjectEntry[],
): Promise<Map<string, string> | null> {
  if (!field) return null;
  if (isTaxonomyValueField(field)) return buildTaxonomyValueMap(field, existingEntries);
  return buildMetaobjectReferenceMap(field, allDefinitions);
}

export interface BulkImportPlan {
  nameKey: string;
  colorKey: string;
  baseColorKey: string;
  baseColorIsList: boolean;
  basePatternKey: string | null;
  basePatternIsList: boolean;
  /** Lowercased Base Color name -> resolved id. */
  baseColorMap: Record<string, string>;
  resolvedPatternId: string | null;
}

/**
 * Resolves everything needed to create Color entries one at a time — the
 * field keys and the Base Color name -> id map — in a single upfront call,
 * so the client can then create rows individually (and show per-row
 * progress) without re-fetching the whole store's reference data for every
 * single row.
 */
export async function prepareBulkImportAction(
  type: string,
  patternId?: string,
): Promise<BulkImportPlan | { error: string }> {
  const definition = await getMetaobjectDefinition(type).catch(() => null);
  if (!definition) return { error: `Couldn't load the "${type}" metaobject definition.` };

  const nameField = findLabelField(definition.fieldDefinitions);
  const colorField = findColorField(definition.fieldDefinitions);
  const baseColorField = findBaseColorField(definition.fieldDefinitions);
  const basePatternField = findBasePatternField(definition.fieldDefinitions);

  if (!nameField || !colorField) {
    return { error: `The "${definition.name}" definition doesn't have the expected name/color fields.` };
  }
  if (!baseColorField) {
    return {
      error: `Couldn't find a "Base color" reference field on "${definition.name}". Fields on this definition: ${definition.fieldDefinitions.map((f) => `${f.name} (${f.key}, ${f.typeName})`).join(", ")}`,
    };
  }

  const existingEntries = await getAllMetaobjectEntries(type);
  const allDefinitions = await getMetaobjectDefinitions();

  const [baseColorMap, basePatternMap] = await Promise.all([
    buildReferenceMap(baseColorField, allDefinitions, existingEntries),
    patternId ? Promise.resolve(null) : buildReferenceMap(basePatternField, allDefinitions, existingEntries),
  ]);

  if (!baseColorMap || baseColorMap.size === 0) {
    return {
      error: `Found the "${baseColorField.name}" field, but couldn't resolve any of its values — this store's "${definition.name}" definition may not have any entries yet to learn valid Base Color values from. Add one manually in Shopify admin first, then retry.`,
    };
  }

  const resolvedPatternId = patternId ?? (basePatternMap ? basePatternMap.get("solid") : undefined);

  return {
    nameKey: nameField.key,
    colorKey: colorField.key,
    baseColorKey: baseColorField.key,
    baseColorIsList: baseColorField.typeName.startsWith("list."),
    basePatternKey: basePatternField?.key ?? null,
    basePatternIsList: basePatternField?.typeName.startsWith("list.") ?? false,
    baseColorMap: Object.fromEntries(baseColorMap),
    resolvedPatternId: resolvedPatternId ?? null,
  };
}

export interface DuplicateCheckResult {
  duplicates: string[];
  newNames: string[];
}

export async function checkDuplicateNamesAction(
  type: string,
  names: string[],
): Promise<DuplicateCheckResult> {
  const existing = await getAllMetaobjectEntries(type);
  const existingNames = new Set(existing.map((e) => e.displayName.trim().toLowerCase()));
  const duplicates: string[] = [];
  const newNames: string[] = [];
  for (const name of names) {
    if (existingNames.has(name.trim().toLowerCase())) duplicates.push(name);
    else newNames.push(name);
  }
  return { duplicates, newNames };
}
