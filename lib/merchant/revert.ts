import type { ClientChange } from "./applyClient";
import type { HistoryEntry } from "./types";

const FILES_PER_CALL = 25;
const VARIANTS_PER_CALL = 100;

/** The changes that put a run back the way it was: every recorded "before" value is written again. */
export function revertChanges(entries: HistoryEntry[]): ClientChange[] {
  const changes: ClientChange[] = [];

  const prices = new Map<string, Extract<HistoryEntry, { kind: "variantPrice" }>[]>();
  const alts: Extract<HistoryEntry, { kind: "mediaAlt" }>[] = [];

  for (const entry of entries) {
    switch (entry.kind) {
      case "variantPrice":
        prices.set(entry.productId, [...(prices.get(entry.productId) ?? []), entry]);
        break;
      case "mediaAlt":
        alts.push(entry);
        break;
      case "productSeo":
        changes.push({ key: `seo#${entry.productId}`, item: { kind: "productSeo", productId: entry.productId, seo: { title: entry.before.title, description: entry.before.description } } });
        break;
      case "redirect":
        changes.push({ key: `redirect#${entry.redirectId}`, item: { kind: "redirectDelete", id: entry.redirectId } });
        break;
    }
  }

  for (const [productId, group] of prices) {
    for (let index = 0; index < group.length; index += VARIANTS_PER_CALL) {
      const slice = group.slice(index, index + VARIANTS_PER_CALL);
      changes.push({
        key: `price#${productId}#${index}`,
        item: { kind: "variantPrice", productId, variants: slice.map((entry) => ({ id: entry.variantId, price: entry.before.price, compareAtPrice: entry.before.compareAtPrice })) },
      });
    }
  }

  for (let index = 0; index < alts.length; index += FILES_PER_CALL) {
    const slice = alts.slice(index, index + FILES_PER_CALL);
    changes.push({ key: `alt#${index}`, item: { kind: "mediaAlt", files: slice.map((entry) => ({ id: entry.fileId, alt: entry.before })) } });
  }

  return changes;
}
