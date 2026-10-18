import type { ConversionSettings, ImageFormat } from "./imageProcessing";
import type { ConversionUiState } from "@/components/products/MediaConversionSettings";

/** "leave" = no conversion at all (today's behavior); anything else is an `ImageFormat` handed to `processImage`. */
export type ConvertTo = "leave" | ImageFormat;

/** What the Web Worker needs to convert one finished image — plain data, safe to structured-clone into a worker. */
export interface WorkerConversion {
  settings: ConversionSettings;
  renamePattern: string;
}

export function toConversionSettings(ui: ConversionUiState, format: ImageFormat): ConversionSettings {
  const maxSizeBytes =
    ui.maxSizeOption === "none" ? null : ui.maxSizeOption === "custom" ? ui.customMaxSizeKb * 1024 : Number(ui.maxSizeOption) * 1024;
  return {
    format,
    quality: ui.quality / 100,
    maxSizeBytes,
    resizeOverMegapixels: ui.resizeOverMegapixels,
    customResize: ui.customResizeEnabled ? { width: ui.customWidth, height: ui.customHeight } : null,
  };
}

/**
 * Same `{name}` / `{folder}` / `{index}` / `{ext}` template as the Media
 * Format Converter's rename pattern. `filename` is the already-converted
 * output name (so `{ext}` is the new extension); a blank pattern keeps it.
 */
export function applyRenamePattern(pattern: string, filename: string, folder: string, index: number): string {
  if (!pattern.trim()) return filename;
  const ext = filename.split(".").pop() ?? "";
  const name = filename.replace(/\.[^.]+$/, "");
  return pattern.replaceAll("{name}", name).replaceAll("{folder}", folder).replaceAll("{index}", String(index)).replaceAll("{ext}", ext);
}

/**
 * A short, stable fingerprint of everything that changes what a converted
 * file looks like. Used to keep each distinct set of conversion settings in
 * its own output folder, so a ZIP exported with WebP never contains leftover
 * JPEG/PNG files from an earlier run with different settings.
 */
export function conversionTag(settings: ConversionSettings, renamePattern: string): string {
  const text = JSON.stringify([
    settings.format,
    Math.round(settings.quality * 100),
    settings.maxSizeBytes,
    settings.resizeOverMegapixels,
    settings.customResize,
    renamePattern.trim(),
  ]);
  // FNV-1a — tiny and dependency-free; collisions between a user's own handful of setting combinations are not a concern.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `cv-${hash.toString(16).padStart(8, "0")}`;
}
