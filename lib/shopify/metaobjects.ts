import { shopifyGraphQL } from "./client";
import type { UserError } from "./types";

export interface MetaobjectFieldDefinition {
  key: string;
  name: string;
  required: boolean;
  typeName: string;
  /** One or more metaobject definition IDs this field can reference — a reference field can allow more than one target type. */
  referencedDefinitionIds: string[];
}

export interface MetaobjectDefinitionSummary {
  id: string;
  name: string;
  type: string;
  entryCount: number;
}

export interface MetaobjectDefinitionDetail extends MetaobjectDefinitionSummary {
  fieldDefinitions: MetaobjectFieldDefinition[];
}

const DEFINITIONS_QUERY = `
  query MetaobjectDefinitions($first: Int!) {
    metaobjectDefinitions(first: $first) {
      nodes {
        id
        name
        type
        metaobjectsCount
      }
    }
  }
`;

export async function getMetaobjectDefinitions(): Promise<MetaobjectDefinitionSummary[]> {
  const data = await shopifyGraphQL<{
    metaobjectDefinitions: { nodes: { id: string; name: string; type: string; metaobjectsCount: number }[] };
  }>(DEFINITIONS_QUERY, { first: 100 });
  return data.metaobjectDefinitions.nodes.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    entryCount: d.metaobjectsCount,
  }));
}

const DEFINITION_QUERY = `
  query MetaobjectDefinitionByType($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      name
      type
      metaobjectsCount
      fieldDefinitions {
        key
        name
        required
        type { name }
        validations { name value }
      }
    }
  }
`;

/**
 * Reference-field validations vary by field type: a single-target field
 * (metaobject_reference) uses "metaobject_definition_id" with one ID, while
 * a field that can target several definitions (list.metaobject_reference /
 * mixed_reference) uses "metaobject_definition_ids" with a JSON array.
 * Both are checked since a field's exact shape can't be assumed.
 */
function extractReferencedDefinitionIds(validations: { name: string; value: string | null }[]): string[] {
  const ids = new Set<string>();
  for (const validation of validations) {
    if (!validation.value) continue;
    if (validation.name === "metaobject_definition_id") {
      ids.add(validation.value);
    } else if (validation.name === "metaobject_definition_ids") {
      try {
        const parsed = JSON.parse(validation.value) as string[];
        for (const id of parsed) ids.add(id);
      } catch {
        // malformed validation payload — skip
      }
    }
  }
  return Array.from(ids);
}

interface RawFieldDefinition {
  key: string;
  name: string;
  required: boolean;
  type: { name: string };
  validations: { name: string; value: string | null }[];
}

export async function getMetaobjectDefinition(type: string): Promise<MetaobjectDefinitionDetail | null> {
  const data = await shopifyGraphQL<{
    metaobjectDefinitionByType: {
      id: string;
      name: string;
      type: string;
      metaobjectsCount: number;
      fieldDefinitions: RawFieldDefinition[];
    } | null;
  }>(DEFINITION_QUERY, { type });
  const def = data.metaobjectDefinitionByType;
  if (!def) return null;
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    entryCount: def.metaobjectsCount,
    fieldDefinitions: def.fieldDefinitions.map((f) => ({
      key: f.key,
      name: f.name,
      required: f.required,
      typeName: f.type.name,
      referencedDefinitionIds: extractReferencedDefinitionIds(f.validations),
    })),
  };
}

export interface MetaobjectEntry {
  id: string;
  handle: string;
  displayName: string;
  updatedAt: string;
  fields: { key: string; value: string | null }[];
}

const ENTRIES_QUERY = `
  query MetaobjectEntries($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after, sortKey: "display_name") {
      nodes {
        id
        handle
        displayName
        updatedAt
        fields { key value }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export async function getMetaobjectEntries(
  type: string,
  options?: { first?: number; after?: string },
): Promise<{ nodes: MetaobjectEntry[]; pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null } }> {
  const data = await shopifyGraphQL<{
    metaobjects: {
      nodes: MetaobjectEntry[];
      pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null };
    };
  }>(ENTRIES_QUERY, { type, first: options?.first ?? 50, after: options?.after });
  return data.metaobjects;
}

/** Fetches every entry of a type (paginating in pages of 250) — used for duplicate checks and reference lookups. */
export async function getAllMetaobjectEntries(type: string, cap = 1000): Promise<MetaobjectEntry[]> {
  const all: MetaobjectEntry[] = [];
  let after: string | undefined;
  while (all.length < cap) {
    const page = await getMetaobjectEntries(type, { first: 250, after });
    all.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor ?? undefined;
  }
  return all;
}

const METAOBJECT_CREATE_MUTATION = `
  mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id handle displayName }
      userErrors { field message code }
    }
  }
`;

const NODES_QUERY = `
  query MetaobjectNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Metaobject { id displayName }
      ... on MediaImage { id image { url } }
      ... on TaxonomyValue { id name }
    }
  }
`;

/** Resolves a batch of GIDs (metaobject references, media images, and/or taxonomy values) to a display label in one request. */
export async function resolveReferenceLabels(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (unique.length === 0) return new Map();
  const data = await shopifyGraphQL<{
    nodes: ({ id: string; displayName?: string; name?: string; image?: { url: string } } | null)[];
  }>(NODES_QUERY, { ids: unique });
  const map = new Map<string, string>();
  for (const node of data.nodes) {
    if (!node) continue;
    map.set(node.id, node.displayName ?? node.name ?? node.image?.url ?? node.id);
  }
  return map;
}

export async function createMetaobjectEntry(
  type: string,
  fields: { key: string; value: string }[],
): Promise<{ id: string | null; displayName: string | null; userErrors: UserError[] }> {
  const data = await shopifyGraphQL<{
    metaobjectCreate: {
      metaobject: { id: string; handle: string; displayName: string } | null;
      userErrors: UserError[];
    };
  }>(METAOBJECT_CREATE_MUTATION, { metaobject: { type, fields } });
  return {
    id: data.metaobjectCreate.metaobject?.id ?? null,
    displayName: data.metaobjectCreate.metaobject?.displayName ?? null,
    userErrors: data.metaobjectCreate.userErrors,
  };
}
