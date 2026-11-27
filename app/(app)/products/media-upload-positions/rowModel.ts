import type { MediaSkuProduct } from "../media-upload/actions";
import { planSteps, parseFolderPositions, type FolderPositions, type OrderedMediaItem, type PositionStep } from "@/lib/positionMedia";
import type { SkuMediaFolder } from "@/lib/skuMediaZip";

/** What the product's gallery lookup gave back — the images, or why they couldn't be read. */
export type GalleryState = { ok: true; media: OrderedMediaItem[] } | { ok: false; error: string };

export interface PositionRowModel {
  sku: string;
  parse: FolderPositions;
  /** Every distinct product that carries this SKU. */
  candidates: MediaSkuProduct[];
  /** The product the images go to: the only candidate, or the one the user picked when several share the SKU. */
  product: MediaSkuProduct | null;
  gallery: GalleryState | null;
  steps: PositionStep[];
}

export interface PositionOutcome {
  position: number;
  ok: boolean;
  error?: string;
}

export interface RowResult {
  outcomes: PositionOutcome[];
  /** A failure that stopped the whole row before any position was tried. */
  error?: string;
}

export function buildRows(
  folders: SkuMediaFolder[],
  candidatesBySku: Map<string, MediaSkuProduct[]>,
  galleries: Record<string, GalleryState>,
  chosen: Record<string, string>,
): PositionRowModel[] {
  return folders.map((folder) => {
    const parse = parseFolderPositions(folder.filePaths);
    const candidates = candidatesBySku.get(folder.sku) ?? [];
    const product = candidates.length === 1 ? candidates[0] : (candidates.find((c) => c.id === chosen[folder.sku]) ?? null);
    const gallery = product ? (galleries[product.id] ?? null) : null;
    const steps = gallery?.ok ? planSteps(parse.files, gallery.media) : [];
    return { sku: folder.sku, parse, candidates, product, gallery, steps };
  });
}

export const replaceableSteps = (row: PositionRowModel): PositionStep[] => row.steps.filter((s) => s.state === "replace");

/** True when anything about this row needs the user's attention before (or instead of) uploading. */
export function rowHasProblem(row: PositionRowModel): boolean {
  if (row.candidates.length === 0 || !row.product) return true;
  if (row.gallery?.ok === false) return true;
  return row.parse.issues.length > 0 || row.steps.some((s) => s.state !== "replace") || row.parse.files.length === 0;
}
