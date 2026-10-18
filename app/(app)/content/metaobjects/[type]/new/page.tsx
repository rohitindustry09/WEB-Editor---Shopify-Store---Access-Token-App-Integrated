import { notFound } from "next/navigation";
import { NewEntryForm } from "./NewEntryForm";
import {
  getAllMetaobjectEntries,
  getMetaobjectDefinition,
  getMetaobjectDefinitions,
} from "@/lib/shopify/metaobjects";

export default async function NewMetaobjectEntryPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type: rawType } = await params;
  const type = decodeURIComponent(rawType);

  const definition = await getMetaobjectDefinition(type);
  if (!definition) notFound();

  const referenceFields = definition.fieldDefinitions.filter(
    (f) => f.typeName === "metaobject_reference" || f.typeName === "list.metaobject_reference",
  );

  const referenceOptions: Record<string, { id: string; label: string }[]> = {};
  if (referenceFields.length > 0) {
    const allDefinitions = await getMetaobjectDefinitions();
    for (const field of referenceFields) {
      const targets = allDefinitions.filter((d) => field.referencedDefinitionIds.includes(d.id));
      if (targets.length === 0) continue;
      const options: { id: string; label: string }[] = [];
      for (const target of targets) {
        const entries = await getAllMetaobjectEntries(target.type, 250);
        options.push(...entries.map((e) => ({ id: e.id, label: e.displayName })));
      }
      referenceOptions[field.key] = options;
    }
  }

  return <NewEntryForm definition={definition} referenceOptions={referenceOptions} />;
}
