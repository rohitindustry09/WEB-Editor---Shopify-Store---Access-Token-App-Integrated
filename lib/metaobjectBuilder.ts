/**
 * The Metaobject & metafield builder's logic: reading a CSV of fields into metaobject definitions and the
 * metafield definitions that reference them. Pure functions (no store access), shared by the browser (for the
 * live preview) and the server (to validate again before anything is created).
 */

/** The field types the builder can create, with the words a CSV is likely to use for each. */
export interface BuilderType {
  /** Our identifier. `file_reference:image` etc. carry the file kind after the colon. */
  value: string;
  label: string;
  /** Lower-case spellings that count as this type when the CSV is read. */
  aliases: string[];
}

export const BUILDER_TYPES: BuilderType[] = [
  { value: "single_line_text_field", label: "Single line text", aliases: ["single line text", "single line", "text", "string", "short text"] },
  { value: "multi_line_text_field", label: "Multi-line text", aliases: ["multi-line text", "multi line text", "multiline text", "multiline", "long text", "textarea", "paragraph"] },
  { value: "rich_text_field", label: "Rich text", aliases: ["rich text", "richtext", "html", "formatted text"] },
  { value: "file_reference:image", label: "File — image", aliases: ["file (image)", "file image", "image", "picture", "photo", "image file"] },
  { value: "file_reference:any", label: "File — any type", aliases: ["file", "file (any)", "document", "file (document)"] },
  { value: "file_reference:video", label: "File — video", aliases: ["file (video)", "video"] },
  { value: "list.file_reference:image", label: "List of images", aliases: ["list of images", "image list", "images", "gallery", "list (image)", "file list (image)"] },
  { value: "list.single_line_text_field", label: "List of single line text", aliases: ["list of text", "text list", "list (text)", "list of single line text", "tags list"] },
  { value: "number_integer", label: "Integer", aliases: ["integer", "whole number", "int", "number (integer)"] },
  { value: "number_decimal", label: "Decimal", aliases: ["decimal", "float", "number", "number (decimal)"] },
  { value: "boolean", label: "True or false", aliases: ["boolean", "true/false", "true or false", "bool", "checkbox", "yes/no"] },
  { value: "url", label: "URL", aliases: ["url", "link", "web link", "link (url)"] },
  { value: "color", label: "Color", aliases: ["color", "colour", "hex", "hex colour", "hex color"] },
  { value: "date", label: "Date", aliases: ["date"] },
  { value: "date_time", label: "Date and time", aliases: ["date and time", "datetime", "date time", "date & time"] },
  { value: "json", label: "JSON", aliases: ["json"] },
  { value: "list.product_reference", label: "List of products", aliases: ["list of products", "list of product", "product list", "products", "products (list)", "list (product)", "list of product references", "multi product"] },
  { value: "list.collection_reference", label: "List of collections", aliases: ["list of collections", "collection list", "collections", "list (collection)"] },
  { value: "list.variant_reference", label: "List of variants", aliases: ["list of variants", "variant list", "variants", "list (variant)"] },
  { value: "product_reference", label: "Product reference", aliases: ["product reference", "product", "product (reference)"] },
  { value: "collection_reference", label: "Collection reference", aliases: ["collection reference", "collection", "collection (reference)"] },
  { value: "variant_reference", label: "Variant reference", aliases: ["variant reference", "variant"] },
  { value: "money", label: "Money", aliases: ["money", "price", "currency"] },
  { value: "weight", label: "Weight", aliases: ["weight"] },
  { value: "dimension", label: "Dimension", aliases: ["dimension", "length", "size"] },
  { value: "volume", label: "Volume", aliases: ["volume"] },
];

const normalizeLabel = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");

/** The builder type a CSV label stands for, or undefined when it isn't recognised (the user then picks one). */
export function guessType(label: string): string | undefined {
  const text = normalizeLabel(label);
  if (!text) return undefined;
  const exact = BUILDER_TYPES.find((type) => type.value === text || normalizeLabel(type.label) === text || type.aliases.includes(text));
  if (exact) return exact.value;
  // Shopify's own names, e.g. "list.single_line_text_field" or "file_reference".
  if (text === "file_reference") return "file_reference:any";
  return undefined;
}

/** Splits our identifier into what Shopify's API wants: the real type name and any validation it needs. */
export function toShopifyType(value: string): { type: string; validations: { name: string; value: string }[] } | null {
  if (!BUILDER_TYPES.some((type) => type.value === value)) return null;
  const [type, fileKind] = value.split(":");
  if (!fileKind || fileKind === "any") return { type, validations: [] };
  return { type, validations: [{ name: "file_type_options", value: JSON.stringify([fileKind === "image" ? "Image" : "Video"]) }] };
}

/** A field as Shopify holds it: its type name and, for file fields, which kinds of file it accepts. */
export interface RemoteField {
  key: string;
  type: string;
  /** "Image", "Video" and/or "GenericFile"; empty when the field has no file restriction. */
  fileKinds: string[];
}

/** What a field should look like in Shopify, from our type — null for a type we don't know. */
export function expectedRemote(value: string): { type: string; fileKinds: string[] } | null {
  const shopify = toShopifyType(value);
  if (!shopify) return null;
  const kinds = shopify.validations.find((validation) => validation.name === "file_type_options");
  return { type: shopify.type, fileKinds: kinds ? (JSON.parse(kinds.value) as string[]) : [] };
}

/** True when the field in Shopify is what we planned: the right type, and the right file kind for image/video pickers. */
export function matchesRemote(plannedType: string, remote: RemoteField | undefined): boolean {
  const expected = expectedRemote(plannedType);
  if (!expected || !remote || remote.type !== expected.type) return false;
  if (expected.fileKinds.length === 0) return true;
  return remote.fileKinds.length === expected.fileKinds.length && expected.fileKinds.every((kind) => remote.fileKinds.includes(kind));
}

/** A short description of what the field accepts in Shopify, for the review table. */
export function describeRemote(remote: RemoteField): string {
  if (!remote.type.endsWith("file_reference")) return remote.type;
  const picker = remote.fileKinds.length === 0 ? "any file" : remote.fileKinds.map((kind) => (kind === "GenericFile" ? "files" : `${kind.toLowerCase()}s`)).join(" + ");
  return `${remote.type} (${picker})`;
}

export interface ColumnMapping {
  objectKey: number;
  fieldName: number;
  fieldKey: number;
  fieldType: number;
  /** `namespace.key` of the metafield that points at the object — optional. */
  metafieldKey: number;
  /** A readable name for the block (used as the metafield's name) — optional. */
  blockName: number;
}

export const NO_COLUMN = -1;

/** Picks the CSV column for each role from its header text; roles with no obvious column stay unmapped. */
export function guessMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((header) => header.trim().toLowerCase());
  const find = (test: (header: string) => boolean, taken: number[]): number => {
    const index = lower.findIndex((header, i) => !taken.includes(i) && test(header));
    return index >= 0 ? index : NO_COLUMN;
  };
  const metafieldKey = find((h) => /metafield/.test(h) && !/\b(name|label|title)\b/.test(h), []);
  const used = [metafieldKey];
  const objectKey = find((h) => /^object\b|definition key|object key|metaobject (type|key|handle)|^definition$|^type handle$/.test(h), used);
  used.push(objectKey);
  const fieldName = find((h) => /^field (name|label|title)|^field$|^name$/.test(h), used);
  used.push(fieldName);
  const fieldKey = find((h) => /^field (key|handle|id)|^key$/.test(h), used);
  used.push(fieldKey);
  const fieldType = find((h) => /^field type|^type$|^data type/.test(h), used);
  used.push(fieldType);
  const blockName = find((h) => /block in theme|block name|^block$|display name|definition name|metafield (name|label|title)|^title$/.test(h), used);
  return { objectKey, fieldName, fieldKey, fieldType, metafieldKey, blockName };
}

export interface PlannedField {
  key: string;
  name: string;
  /** One of the BUILDER_TYPES values. */
  type: string;
}

export interface PlannedObject {
  /** The definition's type handle, e.g. `showcase_banner`. */
  type: string;
  name: string;
  fields: PlannedField[];
}

export interface PlannedMetafield {
  namespace: string;
  key: string;
  name: string;
  /** The `type` of the metaobject definition this metafield points at. */
  objectType: string;
}

export interface Plan {
  objects: PlannedObject[];
  metafields: PlannedMetafield[];
  /** Rows (or whole definitions) that can't be created, each with the reason. */
  problems: string[];
}

export type OwnerType = "PRODUCT" | "COLLECTION";

// Shopify's own limits for these names.
const OBJECT_TYPE = /^[a-z0-9_-]{3,255}$/;
const FIELD_KEY = /^[A-Za-z0-9_-]{2,64}$/;
const NAMESPACE = /^[A-Za-z0-9_-]{3,255}$/;
const METAFIELD_KEY = /^[A-Za-z0-9_-]{2,64}$/;
const MAX_NAME = 255;
/** Shopify's limit on field definitions in one metaobject definition. */
export const MAX_FIELDS_PER_OBJECT = 40;

/** "showcase_image_heading" → "Showcase image heading". */
export function titleFromKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** "custom.showcase_banner" → its namespace and key; null when it isn't in that shape. */
export function parseMetafieldKey(text: string): { namespace: string; key: string } | null {
  const trimmed = text.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0) return null;
  const namespace = trimmed.slice(0, dot);
  const key = trimmed.slice(dot + 1);
  return NAMESPACE.test(namespace) && METAFIELD_KEY.test(key) ? { namespace, key } : null;
}

export function validateObject(object: PlannedObject): string | null {
  if (!OBJECT_TYPE.test(object.type)) return `The object key "${object.type}" must be 3–255 lowercase letters, numbers, - or _.`;
  if (!object.name.trim() || object.name.length > MAX_NAME) return `The object "${object.type}" needs a name (up to 255 characters).`;
  if (object.fields.length === 0) return `The object "${object.type}" has no fields.`;
  if (object.fields.length > MAX_FIELDS_PER_OBJECT) return `The object "${object.type}" has ${object.fields.length} fields — Shopify allows at most ${MAX_FIELDS_PER_OBJECT} in one definition.`;
  const seen = new Set<string>();
  for (const field of object.fields) {
    if (!FIELD_KEY.test(field.key)) return `The field key "${field.key}" must be 2–64 letters, numbers, - or _.`;
    if (seen.has(field.key)) return `The field key "${field.key}" appears twice in "${object.type}".`;
    seen.add(field.key);
    if (!field.name.trim() || field.name.length > MAX_NAME) return `The field "${field.key}" needs a name.`;
    if (!toShopifyType(field.type)) return `The field "${field.key}" has an unsupported type.`;
  }
  return null;
}

export function validateMetafield(metafield: PlannedMetafield): string | null {
  if (!NAMESPACE.test(metafield.namespace) || !METAFIELD_KEY.test(metafield.key)) return `"${metafield.namespace}.${metafield.key}" isn't a valid metafield key.`;
  if (!metafield.name.trim() || metafield.name.length > MAX_NAME) return `The metafield "${metafield.namespace}.${metafield.key}" needs a name.`;
  if (!OBJECT_TYPE.test(metafield.objectType)) return `The metafield "${metafield.namespace}.${metafield.key}" points at an invalid object.`;
  return null;
}

/** "One object" mode: every row of the file is a field of this single object. */
export interface SingleObjectOptions {
  type: string;
  name: string;
  /** The metafield that points at the object, or null to create none. */
  metafield: { namespace: string; key: string; name: string } | null;
}

export interface PlanOptions {
  /** One entry per distinct CSV type label → the builder type chosen for it. */
  typeChoices: Record<string, string>;
  /** When no metafield column is mapped: create `custom.<object type>` for every object. */
  autoMetafields: boolean;
  /** Names the user typed over the generated ones, by object type. */
  objectNames: Record<string, string>;
  /** Names the user typed over a field's name, by `<object type>.<field key>`. */
  fieldNames?: Record<string, string>;
  /** When set, the file has no object column: all rows are fields of this one object. */
  single?: SingleObjectOptions;
}

const cell = (cells: string[], index: number): string => (index === NO_COLUMN ? "" : (cells[index] ?? "").trim());

/**
 * Turns the CSV rows into definitions. Rows that repeat an object's field are merged (the same object is
 * often used by several blocks), and every row that can't be used is reported with its line number.
 */
export function buildPlan(rows: string[][], mapping: ColumnMapping, options: PlanOptions): Plan {
  const objects = new Map<string, PlannedObject>();
  const metafields = new Map<string, PlannedMetafield>();
  const problems: string[] = [];
  const single = options.single;
  if (single && !OBJECT_TYPE.test(single.type)) problems.push(`The object handle "${single.type}" must be 3–255 lowercase letters, numbers, - or _.`);

  rows.forEach((cells, index) => {
    const line = index + 2; // the header is line 1
    const objectKey = single ? single.type : cell(cells, mapping.objectKey).toLowerCase();
    const fieldKey = cell(cells, mapping.fieldKey);
    if (!objectKey && !fieldKey) return; // a blank row
    if (single && !OBJECT_TYPE.test(objectKey)) return; // already reported once, not on every row
    if (!OBJECT_TYPE.test(objectKey)) return void problems.push(`Line ${line}: the object key "${objectKey}" must be 3–255 lowercase letters, numbers, - or _.`);
    if (!FIELD_KEY.test(fieldKey)) return void problems.push(`Line ${line}: the field key "${fieldKey}" must be 2–64 letters, numbers, - or _.`);
    const typeLabel = cell(cells, mapping.fieldType);
    const type = options.typeChoices[typeLabel] ?? guessType(typeLabel);
    if (!type || !toShopifyType(type)) return void problems.push(`Line ${line}: the field type "${typeLabel}" isn't mapped to a Shopify type yet.`);

    const object = objects.get(objectKey) ?? { type: objectKey, name: single ? single.name.trim() || titleFromKey(objectKey) : (options.objectNames[objectKey] ?? titleFromKey(objectKey)), fields: [] };
    objects.set(objectKey, object);
    const existing = object.fields.find((field) => field.key === fieldKey);
    if (existing) {
      if (existing.type !== type) problems.push(`Line ${line}: the field "${fieldKey}" of "${objectKey}" is already ${existing.type}; the first one is used.`);
    } else {
      const typedName = options.fieldNames?.[`${objectKey}.${fieldKey}`];
      object.fields.push({ key: fieldKey, name: typedName ?? (cell(cells, mapping.fieldName) || titleFromKey(fieldKey)), type });
    }

    if (single) return; // the one metafield is added below
    const metafieldText = cell(cells, mapping.metafieldKey);
    if (!metafieldText) return;
    const parsed = parseMetafieldKey(metafieldText);
    if (!parsed) return void problems.push(`Line ${line}: "${metafieldText}" isn't a metafield key like custom.my_block.`);
    const id = `${parsed.namespace}.${parsed.key}`;
    const known = metafields.get(id);
    if (known && known.objectType !== objectKey) return void problems.push(`Line ${line}: the metafield ${id} already points at "${known.objectType}", not "${objectKey}".`);
    if (!known) metafields.set(id, { ...parsed, name: cell(cells, mapping.blockName) || titleFromKey(parsed.key), objectType: objectKey });
  });

  for (const object of objects.values()) {
    if (object.fields.length > MAX_FIELDS_PER_OBJECT) problems.push(`The object "${object.type}" has ${object.fields.length} fields — Shopify allows at most ${MAX_FIELDS_PER_OBJECT} in one definition.`);
  }

  if (single?.metafield && objects.size > 0) {
    const { namespace, key, name } = single.metafield;
    metafields.set(`${namespace}.${key}`, { namespace, key, name: name.trim() || single.name.trim() || titleFromKey(key), objectType: single.type });
  }

  if (!single && mapping.metafieldKey === NO_COLUMN && options.autoMetafields) {
    for (const object of objects.values()) {
      const key = object.type.slice(0, 64);
      if (METAFIELD_KEY.test(key)) metafields.set(`custom.${key}`, { namespace: "custom", key, name: object.name, objectType: object.type });
    }
  }

  return { objects: [...objects.values()], metafields: [...metafields.values()], problems };
}

/** "Product showcase" → "product_showcase": a handle made from a name. */
export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 255);
}

/**
 * Reads a pasted list of fields, one per line as `Name | key | Type` (a leading "1." or "2)" is ignored).
 * Returns rows in the order name, key, type, plus the lines that couldn't be read.
 */
export function parsePastedFields(text: string): { rows: string[][]; skipped: string[] } {
  const rows: string[][] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*\d+[.)]\s*/, "").trim();
    if (!line) continue;
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) skipped.push(raw.trim());
    else rows.push([parts[0], parts[1], parts[2]]);
  }
  return { rows, skipped };
}

/** The distinct type labels in the type column, in order of first appearance. */
export function distinctTypeLabels(rows: string[][], typeColumn: number): string[] {
  const seen = new Set<string>();
  for (const cells of rows) {
    const label = cell(cells, typeColumn);
    if (label) seen.add(label);
  }
  return [...seen];
}
