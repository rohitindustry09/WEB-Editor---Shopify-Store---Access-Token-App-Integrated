import {
  applyZoomAndLogo,
  compositeBackground,
  sampleCornerAverageColor,
  type AverageColor,
  type BackgroundConfig,
  type CanvasShape,
  type ForegroundZoom,
  type LogoOverlay,
  type TextOverlay,
} from "./backgroundComposite";
import { applyRenamePattern, type WorkerConversion } from "./conversionSettings";
import { processImage } from "./imageProcessing";

export type BgItemMode = "primary" | "secondary" | "zoom-only" | "convert-only";

/** Everything one run shares across all its images. */
export interface BgItemConfig {
  primaryConfig: BackgroundConfig;
  secondaryConfig: BackgroundConfig;
  foregroundZoom: ForegroundZoom;
  logo?: LogoOverlay;
  canvasShape: CanvasShape;
  textOverlay?: TextOverlay;
  conversion?: WorkerConversion;
}

export interface BgItemInput {
  /** Path inside the zip; only its file name is used. */
  path: string;
  mode: BgItemMode;
  folder?: string;
  position?: number;
  source: { blob: Blob; mimeType: string };
}

export interface BgItemOutput {
  blob: Blob;
  /** Set when a format conversion / rename pattern decided the final file name. */
  outputFilename?: string;
  avgColor?: AverageColor;
}

/** Composited output is always PNG — the file name follows along so a ".jpg" never actually holds PNG bytes. */
export const outputPathFor = (path: string): string => path.replace(/\.[a-zA-Z0-9]+$/, ".png");

/**
 * Turns one source image into its finished image: background swap / zoom / logo / text, then the optional format conversion.
 * The single implementation behind both the browser's Web Worker and the server job, so the two can't drift apart.
 */
export async function renderItem(input: BgItemInput, config: BgItemConfig): Promise<BgItemOutput> {
  const { source, mode } = input;
  const isBackgroundJob = mode === "primary" || mode === "secondary";
  const baseName = input.path.split("/").pop() ?? input.path;
  const { foregroundZoom, logo, canvasShape, textOverlay, conversion } = config;

  let blob: Blob;
  // What `processImage` is handed: the untouched source for a convert-only job, or the freshly composited PNG (named .png to match its bytes).
  let current = { blob: source.blob, filename: baseName, mimeType: source.mimeType };
  if (mode === "convert-only") {
    blob = source.blob;
  } else {
    blob =
      mode === "primary"
        ? await compositeBackground(source.blob, config.primaryConfig, foregroundZoom, logo, canvasShape, textOverlay)
        : mode === "secondary"
          ? await compositeBackground(source.blob, config.secondaryConfig, foregroundZoom, logo, canvasShape, textOverlay)
          : await applyZoomAndLogo(source.blob, foregroundZoom, logo, canvasShape, textOverlay);
    current = { blob, filename: outputPathFor(baseName), mimeType: "image/png" };
  }
  // Only sampled for an actual background swap — a zoom-only image's corners are whatever the original photo had.
  const avgColor = isBackgroundJob ? await sampleCornerAverageColor(blob).catch(() => undefined) : undefined;

  let outputFilename: string | undefined;
  if (conversion) {
    const converted = await processImage(current, conversion.settings);
    blob = converted.blob;
    outputFilename = applyRenamePattern(conversion.renamePattern, converted.filename, input.folder ?? "", input.position ?? 0);
  }
  return { blob, outputFilename, avgColor };
}
