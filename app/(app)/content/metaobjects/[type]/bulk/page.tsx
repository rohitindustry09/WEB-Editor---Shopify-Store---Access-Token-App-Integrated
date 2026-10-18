import { notFound } from "next/navigation";
import { BulkColorsForm } from "./BulkColorsForm";
import {
  getAllMetaobjectEntries,
  getMetaobjectDefinition,
  getMetaobjectDefinitions,
  resolveReferenceLabels,
} from "@/lib/shopify/metaobjects";
import { findBasePatternField, isTaxonomyValueField } from "@/lib/shopify/colorFieldMatchers";

export default async function BulkColorsPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type: rawType } = await params;
  const type = decodeURIComponent(rawType);

  const definition = await getMetaobjectDefinition(type);
  if (!definition) notFound();

  const basePatternField = findBasePatternField(definition.fieldDefinitions);
  const existingEntries = await getAllMetaobjectEntries(type);

  const patternOptions: { id: string; label: string }[] = [];
  if (basePatternField) {
    if (isTaxonomyValueField(basePatternField)) {
      const ids = new Set<string>();
      for (const entry of existingEntries) {
        const raw = entry.fields.find((f) => f.key === basePatternField.key)?.value;
        if (!raw) continue;
        if (raw.startsWith("[")) {
          try {
            for (const id of JSON.parse(raw) as string[]) ids.add(id);
          } catch {
            // ignore malformed value
          }
        } else {
          ids.add(raw);
        }
      }
      const labels = await resolveReferenceLabels(Array.from(ids));
      const seen = new Set<string>();
      for (const [id, label] of labels) {
        if (seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        patternOptions.push({ id, label });
      }
      patternOptions.sort((a, b) => a.label.localeCompare(b.label));
    } else if (basePatternField.referencedDefinitionIds.length > 0) {
      const allDefinitions = await getMetaobjectDefinitions();
      const targets = allDefinitions.filter((d) => basePatternField.referencedDefinitionIds.includes(d.id));
      for (const target of targets) {
        const entries = await getAllMetaobjectEntries(target.type, 250);
        patternOptions.push(...entries.map((e) => ({ id: e.id, label: e.displayName })));
      }
    }
  }

  return (
    <BulkColorsForm
      type={type}
      definitionName={definition.name}
      patternOptions={patternOptions}
      fieldDefinitions={definition.fieldDefinitions.map((f) => ({ key: f.key, name: f.name, typeName: f.typeName }))}
    />
  );
}
