import { getMetaobjectDefinition, getMetaobjectDefinitions, getAllMetaobjectEntries } from "./metaobjects";
import { findColorField, findLabelField } from "./colorFieldMatchers";

export interface ColorLibraryEntry {
  id: string;
  name: string;
  hex: string | null;
}

export interface ColorLibrary {
  type: string;
  entries: ColorLibraryEntry[];
}

/**
 * Finds the store's "Color" metaobject definition (matched by name, same as
 * the bulk importer) and returns every entry with its label + hex, ready to
 * use as the source list for a Color variant option picker.
 */
export async function getColorLibrary(): Promise<ColorLibrary | null> {
  const definitions = await getMetaobjectDefinitions();
  const colorDef = definitions.find((d) => d.name.toLowerCase() === "color");
  if (!colorDef) return null;

  const detail = await getMetaobjectDefinition(colorDef.type);
  if (!detail) return null;

  const nameField = findLabelField(detail.fieldDefinitions);
  const colorField = findColorField(detail.fieldDefinitions);
  const entries = await getAllMetaobjectEntries(colorDef.type, 250);

  return {
    type: colorDef.type,
    entries: entries.map((e) => ({
      id: e.id,
      name: (nameField && e.fields.find((f) => f.key === nameField.key)?.value) || e.displayName,
      hex: (colorField && e.fields.find((f) => f.key === colorField.key)?.value) || null,
    })),
  };
}
