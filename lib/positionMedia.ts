/**
 * Pure rules for "Upload media by positions": a zip of `<SKU>/<n>.jpg` folders where the number in the
 * file name is the position of the product image it replaces (1 = the first / featured image).
 * Nothing here touches the network, so every rule can be checked on its own.
 */

/** Shopify allows up to 250 media per product, so no position can be higher. */
export const MAX_POSITION = 250;

/** One file in a SKU folder whose name is just a position number. */
export interface PositionFile {
  position: number;
  /** Full path inside the zip. */
  path: string;
  filename: string;
}

export type FolderIssue =
  /** The file name isn't just a number (e.g. "front.jpg"), so no position can be read from it. */
  | { kind: "unnumbered"; filename: string }
  /** Two files claim the same position (e.g. "1.jpg" and "1.png"): neither is used, since either could be the wrong one. */
  | { kind: "duplicate"; position: number; filenames: string[] }
  /** "0.jpg" or a number above Shopify's limit. */
  | { kind: "out-of-range"; filename: string };

export interface FolderPositions {
  /** Usable files, one per position, sorted by position. */
  files: PositionFile[];
  issues: FolderIssue[];
}

const NUMBERED_NAME = /^(\d+)\.[a-z0-9]+$/i;

/** "3.jpg" → 3, "03.png" → 3; anything else (names with letters, "1 (2).jpg") → null. */
export function positionFromFilename(filename: string): number | null {
  const match = NUMBERED_NAME.exec(filename.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/** Reads the position out of every file in one SKU folder and sets aside the ones that can't be trusted. */
export function parseFolderPositions(filePaths: string[]): FolderPositions {
  const issues: FolderIssue[] = [];
  const byPosition = new Map<number, PositionFile[]>();

  for (const path of filePaths) {
    const filename = path.split("/").pop() ?? path;
    const position = positionFromFilename(filename);
    if (position === null) {
      issues.push({ kind: "unnumbered", filename });
      continue;
    }
    if (position < 1 || position > MAX_POSITION) {
      issues.push({ kind: "out-of-range", filename });
      continue;
    }
    const bucket = byPosition.get(position);
    if (bucket) bucket.push({ position, path, filename });
    else byPosition.set(position, [{ position, path, filename }]);
  }

  const files: PositionFile[] = [];
  for (const [position, bucket] of [...byPosition.entries()].sort((a, b) => a[0] - b[0])) {
    if (bucket.length === 1) files.push(bucket[0]);
    else issues.push({ kind: "duplicate", position, filenames: bucket.map((f) => f.filename) });
  }
  return { files, issues };
}

/** One piece of a product's media gallery, in gallery order. */
export interface OrderedMediaItem {
  id: string;
  /** "IMAGE", "VIDEO", "EXTERNAL_VIDEO" or "MODEL_3D". Only images can be replaced with a picture. */
  kind: string;
  /** "READY", "PROCESSING", "UPLOADED" or "FAILED" — Shopify only lets a READY file be updated. */
  status: string;
  /** The current image address; null for anything that isn't an image. */
  url: string | null;
}

export type StepState =
  /** Will be replaced in place. */
  | "replace"
  /** The product has fewer images than this position — nothing to replace. */
  | "missing"
  /** The item at this position is a video or 3D model. */
  | "not-image"
  /** The image at this position is still being processed by Shopify. */
  | "not-ready";

export interface PositionStep {
  position: number;
  path: string;
  filename: string;
  state: StepState;
  /** The media item that sits at this position right now (absent when `state` is "missing"). */
  target?: OrderedMediaItem;
}

/** Lines each numbered file up with the media item at the same position in the product's gallery. */
export function planSteps(files: PositionFile[], media: OrderedMediaItem[]): PositionStep[] {
  return files.map((file) => {
    const target = media[file.position - 1];
    const base = { position: file.position, path: file.path, filename: file.filename };
    if (!target) return { ...base, state: "missing" as const };
    if (target.kind !== "IMAGE") return { ...base, state: "not-image" as const, target };
    if (target.status !== "READY") return { ...base, state: "not-ready" as const, target };
    return { ...base, state: "replace" as const, target };
  });
}

export const STEP_LABELS: Record<StepState, string> = {
  replace: "Will replace",
  missing: "No image at this position",
  "not-image": "Position holds a video / 3D model",
  "not-ready": "Image still processing",
};

export function describeIssue(issue: FolderIssue): string {
  switch (issue.kind) {
    case "unnumbered":
      return `"${issue.filename}" isn't named with a position number (like 1.jpg) — skipped.`;
    case "duplicate":
      return `Position ${issue.position} has more than one file (${issue.filenames.join(", ")}) — none of them used.`;
    case "out-of-range":
      return `"${issue.filename}" has a position outside 1–${MAX_POSITION} — skipped.`;
  }
}
