import type { BackgroundConfig, CanvasShape, ForegroundZoom, ImageBackgroundConfig, LogoOverlay, TextOverlay } from "./backgroundComposite";
import type { WorkerConversion } from "./conversionSettings";

/**
 * What a Background customiser run on the SERVER is made of. It's plain JSON (saved next to the job), so the job can be
 * picked up again after the browser closes or the server restarts. Pictures the run needs (a background image, the logo)
 * are saved beside the job as "assets" and referred to by name, since a `Blob` can't live in JSON.
 */

/** Which saved zip on the server the images come from. */
export type BgZipRef = { kind: "drive"; id: string } | { kind: "upload"; id: string };

/** "convert-only" = no background / zoom / logo edit — the original image just goes through format conversion. */
export type BgJobMode = "primary" | "secondary" | "zoom-only" | "convert-only";

export interface BgJobItem {
  /** The image's full path inside the zip. */
  path: string;
  mode: BgJobMode;
  /** Its SKU folder and 1-based position in it — what a rename pattern's {folder} / {index} fill in. */
  folder: string;
  position: number;
}

export type StoredBackground = Exclude<BackgroundConfig, ImageBackgroundConfig> | (Omit<ImageBackgroundConfig, "image"> & { assetId: string });
export type StoredLogo = Omit<LogoOverlay, "image"> & { assetId: string };

export interface BgJobSpec {
  version: 1;
  /** Shown in the job list and used to name the downloaded zip. */
  name: string;
  source: BgZipRef;
  items: BgJobItem[];
  primary: StoredBackground;
  secondary: StoredBackground;
  foregroundZoom: ForegroundZoom;
  logo?: StoredLogo;
  canvasShape: CanvasShape;
  textOverlay?: TextOverlay;
  conversion?: WorkerConversion;
}

export type BgJobStatus =
  /** Waiting for its turn on the server. */
  | "queued"
  | "running"
  | "done"
  /** Stopped by the user; what was finished is kept and can still be downloaded. */
  | "cancelled"
  /** Couldn't start or couldn't continue (e.g. the source zip is gone). */
  | "error";

export interface BgJobFailure {
  path: string;
  message: string;
}

/** What the page sees of a job. */
export interface BgJobSnapshot {
  id: string;
  name: string;
  status: BgJobStatus;
  /** Images this run changes. */
  total: number;
  done: number;
  failed: number;
  /** Images copied unchanged so the download is a complete copy of the zip. */
  copied: number;
  copyTotal: number;
  /** The image being worked on right now. */
  current: string | null;
  error: string | null;
  failures: BgJobFailure[];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Finished images per second, over the last few seconds. */
  itemsPerSecond: number;
  etaSeconds: number | null;
}

export const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const JOB_ID = /^[a-z0-9-]{8,64}$/;

/** Narrows a background from the browser to its stored form, with the image swapped for an asset name. */
export function toStoredBackground(config: BackgroundConfig, assetId: string): StoredBackground {
  if (config.kind !== "image") return config;
  const { image: _image, ...rest } = config;
  void _image;
  return { ...rest, assetId };
}

export function toStoredLogo(logo: LogoOverlay, assetId: string): StoredLogo {
  const { image: _image, ...rest } = logo;
  void _image;
  return { ...rest, assetId };
}

export type { ForegroundZoom, TextOverlay };
