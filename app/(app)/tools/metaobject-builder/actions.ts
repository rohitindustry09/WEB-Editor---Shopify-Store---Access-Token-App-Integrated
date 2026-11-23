"use server";

import { shopifyGraphQL } from "@/lib/shopify/client";
import { getSession } from "@/lib/shopify/session";
import {
  addActivity,
  addFile,
  getActivity,
  isValidBuilderId,
  listActivity,
  listFiles,
  markActivityReverted,
  MAX_FILE_BYTES,
  readSavedFile,
  removeActivity,
  removeFile,
  type ActivityEntry,
  type ActivityMetafield,
  type ActivityObject,
  type ActivitySettings,
  type SavedFile,
} from "@/lib/metaobjectBuilderStore";
import { getMetaobjectDefinition } from "@/lib/shopify/metaobjects";
import type { UserError } from "@/lib/shopify/types";
import { toShopifyType, validateMetafield, validateObject, type OwnerType, type PlannedMetafield, type PlannedObject, type RemoteField } from "@/lib/metaobjectBuilder";

const DEFINITION_GID = /^gid:\/\/shopify\/MetaobjectDefinition\/\d+$/;
const MAX_FIELDS = 40;

interface BuilderUserError extends UserError {
  code?: string;
}

const errorText = (errors: BuilderUserError[]): string => errors.map((error) => error.message).join("; ");
const isTaken = (errors: BuilderUserError[]): boolean => errors.some((error) => error.code === "TAKEN" || /already (been )?taken|already exists|in use/i.test(error.message));
const messageOf = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

const DEFINITION_CREATE = `
  mutation BuilderObjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
    }
  }
`;

const METAFIELD_DEFINITION_CREATE = `
  mutation BuilderMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

const OBJECT_TYPE = /^[a-z0-9_-]{3,255}$/;
const FIELD_KEY = /^[A-Za-z0-9_-]{2,64}$/;

const DEFINITION_READ = `
  query BuilderReadDefinition($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      fieldDefinitions { key type { name } validations { name value } }
    }
  }
`;

const DEFINITION_UPDATE = `
  mutation BuilderUpdateDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition { id }
      userErrors { field message code }
    }
  }
`;

function parseKinds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((kind): kind is string => typeof kind === "string") : [];
  } catch {
    return [];
  }
}

export type ObjectResult = { ok: true; id: string; existed: boolean } | { ok: false; error: string };
export type MetafieldResult = { ok: true; existed: boolean; id: string | null } | { ok: false; error: string };

/**
 * Creates one metaobject definition with its fields. If the store already has one of that type it is reused
 * (its id is returned with `existed`), so running the builder again never fails on what was already made.
 */
export async function createObjectDefinitionAction(object: PlannedObject, storefrontAccess = true): Promise<ObjectResult> {
  const problem = typeof object === "object" && object !== null && Array.isArray(object.fields) && object.fields.length <= MAX_FIELDS ? validateObject(object) : "Invalid definition.";
  if (problem) return { ok: false, error: problem };

  const fieldDefinitions = object.fields.map((field) => {
    const shopify = toShopifyType(field.type);
    return { key: field.key, name: field.name.trim(), type: shopify?.type, ...(shopify && shopify.validations.length > 0 ? { validations: shopify.validations } : {}) };
  });
  // The first plain text field names each entry in the admin list.
  const displayField = object.fields.find((field) => field.type === "single_line_text_field");

  try {
    const data = await shopifyGraphQL<{ metaobjectDefinitionCreate: { metaobjectDefinition: { id: string } | null; userErrors: BuilderUserError[] } }>(DEFINITION_CREATE, {
      definition: {
        type: object.type,
        name: object.name.trim(),
        fieldDefinitions,
        ...(storefrontAccess ? { access: { storefront: "PUBLIC_READ" } } : {}),
        ...(displayField ? { displayNameKey: displayField.key } : {}),
      },
    });
    const { metaobjectDefinition, userErrors } = data.metaobjectDefinitionCreate;
    if (metaobjectDefinition) return { ok: true, id: metaobjectDefinition.id, existed: false };
    if (isTaken(userErrors)) {
      const existing = await getMetaobjectDefinition(object.type);
      if (existing) return { ok: true, id: existing.id, existed: true };
    }
    return { ok: false, error: errorText(userErrors) || "Shopify didn't create the definition." };
  } catch (err) {
    return { ok: false, error: messageOf(err, "Couldn't create the definition.") };
  }
}

/**
 * Reads a definition's fields back from the store — the proof of what Shopify actually holds, for example
 * whether a file field is the image picker or accepts any file.
 */
export async function readObjectDefinitionAction(type: string): Promise<{ ok: true; fields: RemoteField[] } | { ok: false; error: string }> {
  if (typeof type !== "string" || !OBJECT_TYPE.test(type)) return { ok: false, error: "Invalid object handle." };
  try {
    const data = await shopifyGraphQL<{ metaobjectDefinitionByType: { fieldDefinitions: { key: string; type: { name: string }; validations: { name: string; value: string | null }[] }[] } | null }>(DEFINITION_READ, { type });
    const definition = data.metaobjectDefinitionByType;
    if (!definition) return { ok: false, error: "That definition isn't in the store." };
    return {
      ok: true,
      fields: definition.fieldDefinitions.map((field) => ({
        key: field.key,
        type: field.type.name,
        fileKinds: parseKinds(field.validations.find((validation) => validation.name === "file_type_options")?.value ?? ""),
      })),
    };
  } catch (err) {
    return { ok: false, error: messageOf(err, "Couldn't read the definition.") };
  }
}

/** Switches the given file fields of an existing definition to the image picker (accepting images only). */
export async function makeFieldsImageOnlyAction(type: string, keys: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof type !== "string" || !OBJECT_TYPE.test(type)) return { ok: false, error: "Invalid object handle." };
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_FIELDS || !keys.every((key) => typeof key === "string" && FIELD_KEY.test(key))) return { ok: false, error: "Invalid field list." };
  try {
    const read = await shopifyGraphQL<{ metaobjectDefinitionByType: { id: string } | null }>(`query BuilderDefinitionId($type: String!) { metaobjectDefinitionByType(type: $type) { id } }`, { type });
    const id = read.metaobjectDefinitionByType?.id;
    if (!id) return { ok: false, error: "That definition isn't in the store." };
    const data = await shopifyGraphQL<{ metaobjectDefinitionUpdate: { userErrors: BuilderUserError[] } }>(DEFINITION_UPDATE, {
      id,
      definition: { fieldDefinitions: keys.map((key) => ({ update: { key, validations: [{ name: "file_type_options", value: JSON.stringify(["Image"]) }] } })) },
    });
    const errors = data.metaobjectDefinitionUpdate.userErrors;
    return errors.length > 0 ? { ok: false, error: errorText(errors) } : { ok: true };
  } catch (err) {
    return { ok: false, error: messageOf(err, "Couldn't update the definition.") };
  }
}

/** Creates one metafield definition (on products or collections) that holds a reference to a metaobject. */
export async function createMetafieldDefinitionAction(metafield: PlannedMetafield, definitionId: string, ownerType: OwnerType, storefrontAccess = true): Promise<MetafieldResult> {
  const problem = typeof metafield === "object" && metafield !== null ? validateMetafield(metafield) : "Invalid metafield.";
  if (problem) return { ok: false, error: problem };
  if (typeof definitionId !== "string" || !DEFINITION_GID.test(definitionId)) return { ok: false, error: "The metaobject definition id is invalid." };
  if (ownerType !== "PRODUCT" && ownerType !== "COLLECTION") return { ok: false, error: "Choose products or collections." };

  try {
    const data = await shopifyGraphQL<{ metafieldDefinitionCreate: { createdDefinition: { id: string } | null; userErrors: BuilderUserError[] } }>(METAFIELD_DEFINITION_CREATE, {
      definition: {
        name: metafield.name.trim(),
        namespace: metafield.namespace,
        key: metafield.key,
        type: "metaobject_reference",
        ownerType,
        validations: [{ name: "metaobject_definition_id", value: definitionId }],
        ...(storefrontAccess ? { access: { storefront: "PUBLIC_READ" } } : {}),
      },
    });
    const { createdDefinition, userErrors } = data.metafieldDefinitionCreate;
    if (createdDefinition) return { ok: true, existed: false, id: createdDefinition.id };
    if (isTaken(userErrors)) return { ok: true, existed: true, id: null };
    return { ok: false, error: errorText(userErrors) || "Shopify didn't create the metafield." };
  } catch (err) {
    return { ok: false, error: messageOf(err, "Couldn't create the metafield.") };
  }
}

// ---- saved files, activity log, and revert ----

const METAFIELD_DEFINITION_GID = /^gid:\/\/shopify\/MetafieldDefinition\/\d+$/;
const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const OWNER: ReadonlySet<string> = new Set(["PRODUCT", "COLLECTION"]);

export interface BuilderState {
  files: SavedFile[];
  activity: ActivityEntry[];
}

/** The saved files and recent activity for the connected store. */
export async function loadBuilderStateAction(): Promise<{ ok: true } & BuilderState | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not connected to a store." };
  try {
    return { ok: true, files: await listFiles(session.shop), activity: await listActivity(session.shop) };
  } catch (err) {
    return { ok: false, error: messageOf(err, "Couldn't read the saved files.") };
  }
}

/** Keeps an uploaded file on this server so it can be downloaded or attached again later. */
export async function saveSourceFileAction(name: string, kind: string, content: string): Promise<{ ok: true; file: SavedFile } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not connected to a store." };
  if (typeof content !== "string" || content.length === 0) return { ok: false, error: "The file is empty." };
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) return { ok: false, error: "The file is larger than 1 MB, so it wasn't saved." };
  if (kind !== "csv" && kind !== "list") return { ok: false, error: "Unknown file kind." };
  try {
    return { ok: true, file: await addFile(session.shop, text(name, 200) || "file", kind, content) };
  } catch {
    return { ok: false, error: "This server can't store files (its disk is read-only), so the upload wasn't saved." };
  }
}

export async function readSavedFileAction(id: string): Promise<{ ok: true; file: SavedFile; content: string } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || !isValidBuilderId(id)) return { ok: false, error: "That file couldn't be found." };
  const found = await readSavedFile(session.shop, id).catch(() => null);
  return found ? { ok: true, ...found } : { ok: false, error: "That file couldn't be found." };
}

export async function deleteSavedFileAction(id: string): Promise<void> {
  const session = await getSession();
  if (session && isValidBuilderId(id)) await removeFile(session.shop, id).catch(() => undefined);
}

function cleanSettings(raw: unknown): ActivitySettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if ((v.mode !== "multi" && v.mode !== "single") || (v.source !== "csv" && v.source !== "paste") || !OWNER.has(String(v.ownerType))) return null;
  return {
    mode: v.mode,
    source: v.source,
    singleName: text(v.singleName, 255),
    handle: text(v.handle, 255),
    makeMetafield: v.makeMetafield === true,
    metafieldKey: text(v.metafieldKey, 300),
    metafieldName: text(v.metafieldName, 255),
    ownerType: v.ownerType as ActivitySettings["ownerType"],
    storefront: v.storefront === true,
  };
}

/** Writes one finished run into the activity log (only what it created or reused, with Shopify's ids). */
export async function recordActivityAction(input: {
  label: string;
  settings: ActivitySettings;
  fileId: string | null;
  objects: ActivityObject[];
  metafields: ActivityMetafield[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not connected to a store." };
  const settings = cleanSettings(input?.settings);
  if (!settings || !Array.isArray(input.objects) || !Array.isArray(input.metafields)) return { ok: false, error: "Invalid activity." };
  const objects: ActivityObject[] = [];
  for (const object of input.objects.slice(0, 200)) {
    if (!DEFINITION_GID.test(String(object?.id)) || !OBJECT_TYPE.test(String(object.type))) continue;
    objects.push({ type: object.type, name: text(object.name, 255), id: object.id, created: object.created === true, fieldCount: Math.max(0, Math.min(1000, Number(object.fieldCount) || 0)) });
  }
  const metafields: ActivityMetafield[] = [];
  for (const metafield of input.metafields.slice(0, 400)) {
    if (!OWNER.has(String(metafield?.ownerType))) continue;
    const id = typeof metafield.id === "string" && METAFIELD_DEFINITION_GID.test(metafield.id) ? metafield.id : null;
    metafields.push({ namespace: text(metafield.namespace, 255), key: text(metafield.key, 64), ownerType: metafield.ownerType, id, created: metafield.created === true && id !== null });
  }
  try {
    await addActivity(session.shop, { label: text(input.label, 300), settings, fileId: isValidBuilderId(input.fileId) ? input.fileId : null, objects, metafields });
    return { ok: true };
  } catch {
    return { ok: false, error: "This server can't store files (its disk is read-only), so this run can't be listed or reverted here." };
  }
}

export async function deleteActivityAction(id: string): Promise<void> {
  const session = await getSession();
  if (session && isValidBuilderId(id)) await removeActivity(session.shop, id).catch(() => undefined);
}

const ENTRY_COUNT = `query BuilderEntryCount($type: String!) { metaobjectDefinitionByType(type: $type) { metaobjectsCount } }`;

/** How many entries each definition this run created holds right now — deleting a definition deletes its entries too. */
export async function previewRevertAction(id: string): Promise<{ ok: true; entries: { type: string; count: number }[]; deletable: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || !isValidBuilderId(id)) return { ok: false, error: "That run couldn't be found." };
  const entry = await getActivity(session.shop, id).catch(() => null);
  if (!entry) return { ok: false, error: "That run couldn't be found." };
  const created = entry.objects.filter((object) => object.created);
  const entries: { type: string; count: number }[] = [];
  for (const object of created) {
    try {
      const data = await shopifyGraphQL<{ metaobjectDefinitionByType: { metaobjectsCount: number } | null }>(ENTRY_COUNT, { type: object.type });
      entries.push({ type: object.type, count: data.metaobjectDefinitionByType?.metaobjectsCount ?? 0 });
    } catch {
      entries.push({ type: object.type, count: 0 });
    }
  }
  return { ok: true, entries, deletable: created.length + entry.metafields.filter((metafield) => metafield.created).length };
}

const METAFIELD_DELETE = `
  mutation BuilderDeleteMetafieldDefinition($id: ID!) {
    metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: true) {
      deletedDefinitionId
      userErrors { field message code }
    }
  }
`;

const OBJECT_DELETE = `
  mutation BuilderDeleteObjectDefinition($id: ID!) {
    metaobjectDefinitionDelete(id: $id) {
      deletedId
      userErrors { field message code }
    }
  }
`;

const isGone = (errors: BuilderUserError[]): boolean => errors.some((error) => error.code === "NOT_FOUND" || /not found|does not exist|doesn't exist/i.test(error.message));

/**
 * Puts a run back: deletes the metafield definitions it created, then the metaobject definitions it created
 * (with all their fields). Anything the run only reused is left alone. A definition that is already gone counts as done.
 */
export async function revertActivityAction(id: string): Promise<{ ok: true; deleted: number; failed: string[] } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || !isValidBuilderId(id)) return { ok: false, error: "That run couldn't be found." };
  const entry = await getActivity(session.shop, id).catch(() => null);
  if (!entry) return { ok: false, error: "That run couldn't be found." };

  let deleted = 0;
  const failed: string[] = [];
  // Metafields first: they point at the definitions, which can't be removed while something refers to them.
  for (const metafield of entry.metafields.filter((candidate) => candidate.created && candidate.id)) {
    try {
      const data = await shopifyGraphQL<{ metafieldDefinitionDelete: { userErrors: BuilderUserError[] } }>(METAFIELD_DELETE, { id: metafield.id });
      const errors = data.metafieldDefinitionDelete.userErrors;
      if (errors.length === 0 || isGone(errors)) deleted += 1;
      else failed.push(`${metafield.namespace}.${metafield.key}: ${errorText(errors)}`);
    } catch (err) {
      failed.push(`${metafield.namespace}.${metafield.key}: ${messageOf(err, "couldn't be deleted")}`);
    }
  }
  for (const object of entry.objects.filter((candidate) => candidate.created)) {
    try {
      const data = await shopifyGraphQL<{ metaobjectDefinitionDelete: { userErrors: BuilderUserError[] } }>(OBJECT_DELETE, { id: object.id });
      const errors = data.metaobjectDefinitionDelete.userErrors;
      if (errors.length === 0 || isGone(errors)) deleted += 1;
      else failed.push(`${object.type}: ${errorText(errors)}`);
    } catch (err) {
      failed.push(`${object.type}: ${messageOf(err, "couldn't be deleted")}`);
    }
  }
  if (failed.length === 0) await markActivityReverted(session.shop, id).catch(() => undefined);
  return { ok: true, deleted, failed };
}
