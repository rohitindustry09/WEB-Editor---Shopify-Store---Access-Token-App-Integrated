import { EntriesView } from "./EntriesView";
import { ShopifyAPIError, ShopifyNotConnectedError } from "@/lib/shopify/client";
import {
  getMetaobjectDefinition,
  getMetaobjectEntries,
  resolveReferenceLabels,
  type MetaobjectDefinitionDetail,
  type MetaobjectEntry,
} from "@/lib/shopify/metaobjects";
import { isReferenceField } from "@/lib/shopify/colorFieldMatchers";

const EMPTY_PAGE_INFO: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null } = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

export default async function MetaobjectEntriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ page?: string; after?: string; before?: string }>;
}) {
  const { type: rawType } = await params;
  const type = decodeURIComponent(rawType);
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;

  let definition: MetaobjectDefinitionDetail | null = null;
  let entries: MetaobjectEntry[] = [];
  let pageInfo = EMPTY_PAGE_INFO;
  let referenceLabels: Record<string, string> = {};
  let error: string | null = null;

  try {
    definition = await getMetaobjectDefinition(type);
    if (definition) {
      const data = await getMetaobjectEntries(type, {
        first: sp.before ? undefined : 50,
        after: sp.after,
      });
      entries = data.nodes;
      pageInfo = data.pageInfo;

      const referenceFieldKeys = new Set(
        definition.fieldDefinitions.filter(isReferenceField).map((f) => f.key),
      );
      const idsToResolve: string[] = [];
      for (const entry of entries) {
        for (const field of entry.fields) {
          if (!referenceFieldKeys.has(field.key) || !field.value) continue;
          if (field.value.startsWith("[")) {
            try {
              idsToResolve.push(...(JSON.parse(field.value) as string[]));
            } catch {
              // ignore malformed reference value
            }
          } else {
            idsToResolve.push(field.value);
          }
        }
      }
      if (idsToResolve.length > 0) {
        const map = await resolveReferenceLabels(idsToResolve);
        referenceLabels = Object.fromEntries(map);
      }
    }
  } catch (err) {
    error =
      err instanceof ShopifyNotConnectedError
        ? "Not connected to a Shopify store yet."
        : err instanceof ShopifyAPIError
          ? err.message
          : "Something went wrong loading this metaobject.";
  }

  return (
    <EntriesView
      definition={definition}
      entries={entries}
      referenceLabels={referenceLabels}
      page={page}
      pageInfo={pageInfo}
      error={error}
    />
  );
}
