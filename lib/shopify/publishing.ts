import { shopifyGraphQL } from "./client";
import { getSession } from "./session";
import type { UserError } from "./types";

const PUBLICATIONS_QUERY = `
  query SalesChannelPublications {
    publications(first: 100) { nodes { id name } }
  }
`;

const PUBLISH_MUTATION = `
  mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const UNPUBLISH_MUTATION = `
  mutation UnpublishProduct($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const CACHE_TTL_MS = 5 * 60_000;
const publicationCache = new Map<string, { at: number; ids: string[] }>();

/** Every sales channel (publication) of the store — the same list for every product, so it is read once and reused for a few minutes. */
async function getPublicationIds(): Promise<string[]> {
  const shop = (await getSession())?.shop ?? "";
  const cached = publicationCache.get(shop);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ids;
  const data = await shopifyGraphQL<{ publications: { nodes: { id: string; name: string }[] } }>(PUBLICATIONS_QUERY);
  const ids = data.publications.nodes.map((n) => n.id);
  publicationCache.set(shop, { at: Date.now(), ids });
  return ids;
}

const errorText = (errors: UserError[]): string => errors.map((e) => e.message).join("; ");

/**
 * Publishes a product to — or removes it from — every sales channel of the
 * store ("Published" TRUE / FALSE in a Shopify product CSV). Returns a readable
 * problem list; empty means it worked. Needs the token's read_publications /
 * write_publications scopes, and says so when Shopify refuses.
 */
export async function setProductPublished(productId: string, published: boolean): Promise<string[]> {
  let ids: string[];
  try {
    ids = await getPublicationIds();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return [`Published: couldn't read the store's sales channels (${reason}). The access token needs the read_publications and write_publications scopes.`];
  }
  if (ids.length === 0) return ["Published: the store has no sales channels to publish to."];
  try {
    const data = await shopifyGraphQL<{
      publishablePublish?: { userErrors: UserError[] };
      publishableUnpublish?: { userErrors: UserError[] };
    }>(published ? PUBLISH_MUTATION : UNPUBLISH_MUTATION, { id: productId, input: ids.map((publicationId) => ({ publicationId })) });
    const errors = (published ? data.publishablePublish : data.publishableUnpublish)?.userErrors ?? [];
    return errors.length > 0 ? [`Published: ${errorText(errors)}`] : [];
  } catch (err) {
    return [`Published: ${err instanceof Error ? err.message : "couldn't update the sales channels"}`];
  }
}
