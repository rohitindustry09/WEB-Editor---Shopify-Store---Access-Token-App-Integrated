/** Types shared by the Merchant Tools — plain data, safe for both the server and the browser. */

/** One variant of the catalog with the product facts the tools need. */
export interface CatalogRow {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  handle: string;
  sku: string;
  barcode: string;
  price: string;
  compareAtPrice: string | null;
  /** Units in stock across locations (null when inventory isn't tracked). */
  stock: number | null;
  tracked: boolean;
  vendor: string;
  productType: string;
  tags: string[];
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  descriptionText: string;
  seoTitle: string;
  seoDescription: string;
  imageCount: number;
}

/** What the catalog is narrowed to — each part is optional and they combine with AND. */
export interface CatalogFilter {
  tag?: string;
  vendor?: string;
  productType?: string;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED" | "";
  sku?: string;
}

export interface CatalogPage {
  rows: CatalogRow[];
  nextCursor: string | null;
}

/** One change a tool made, with enough of the "before" to put it back. */
export type HistoryEntry =
  | {
      kind: "variantPrice";
      productId: string;
      variantId: string;
      label: string;
      before: { price: string; compareAtPrice: string | null };
      after: { price: string; compareAtPrice: string | null };
    }
  | { kind: "mediaAlt"; fileId: string; label: string; before: string; after: string }
  | { kind: "productSeo"; productId: string; label: string; before: { title: string; description: string }; after: { title: string; description: string } }
  | { kind: "redirect"; redirectId: string; label: string; path: string; target: string };

export interface HistoryRunSummary {
  id: string;
  tool: string;
  label: string;
  createdAt: string;
  entryCount: number;
  revertedAt: string | null;
}

/** One unit of work for the apply route. */
export type ApplyItem =
  | { kind: "variantPrice"; productId: string; variants: { id: string; price?: string; compareAtPrice?: string | null }[] }
  | { kind: "mediaAlt"; files: { id: string; alt: string }[] }
  | { kind: "productSeo"; productId: string; seo: { title?: string; description?: string } }
  | { kind: "redirectCreate"; path: string; target: string }
  | { kind: "redirectDelete"; id: string };

export interface ApplyOutcome {
  ok: boolean;
  error?: string;
  /** Set when something was created (a redirect), so it can be undone later. */
  createdId?: string;
}

/** The request body of the apply route. */
export interface ApplyRequest {
  /** Items to apply, each with the history entries to record once it succeeds. */
  items: { item: ApplyItem; entries?: HistoryEntry[] }[];
  /** When given, successful changes are recorded under this run so they can be reverted later. */
  history?: { runId: string; tool: string; label: string };
}
