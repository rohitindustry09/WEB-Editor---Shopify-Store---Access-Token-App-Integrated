import type { ScraperPlatform, ScrapeScope } from "@/lib/storeScraper/types";
import type { CanvasShape, LogoPosition } from "@/lib/backgroundComposite";
import type { ConversionUiState } from "@/components/products/MediaConversionSettings";
import { toPersistableBackgroundState, type PersistableBackgroundEditorState } from "@/app/(app)/tools/bg-customiser/persistedSettings";
import type { BackgroundEditorState } from "@/app/(app)/tools/bg-customiser/backgroundEditorState";
import { createDefaultBackgroundEditorState } from "@/app/(app)/tools/bg-customiser/backgroundEditorState";

const STORAGE_KEY = "allInOnePipeline.presets.v1";

/**
 * Everything the pipeline form's own settings hold EXCEPT the actual store
 * URL (a preset is a reusable style — "my usual Shopify pipeline" — not a
 * specific target, so re-running it against a different store is exactly
 * the point) and the two `File` fields (a background image, a logo) that
 * can't survive `JSON.stringify` — same gap `persistedSettings.ts` already
 * solves for the background customiser itself, reused here rather than
 * duplicated.
 */
export interface PersistablePipelineConfig {
  platform: ScraperPlatform;
  scope: ScrapeScope;
  requestedFields: string;
  containerClasses: string;
  useCache: boolean;
  allowInsecureTls: boolean;
  quickMediaMode: boolean;
  enableBackground: boolean;
  bgStateA: PersistableBackgroundEditorState;
  bgPositionsTextA: string;
  bgStateB: PersistableBackgroundEditorState;
  bgPositionsTextB: string;
  zoomPercent: number;
  canvasShape: CanvasShape;
  logoPosition: LogoPosition;
  logoCustomX: number;
  logoCustomY: number;
  logoSizePercent: number;
  logoMarginPercent: number;
  textOverlayEnabled: boolean;
  textOverlayText: string;
  textOverlayPosition: LogoPosition;
  textOverlayCustomX: number;
  textOverlayCustomY: number;
  textOverlaySizePercent: number;
  textOverlayMarginPercent: number;
  textOverlayColor: string;
  textOverlayHasBackground: boolean;
  textOverlayBackgroundColor: string;
  enableConversion: boolean;
  conversionUi: ConversionUiState;
  notifyWebhookUrl: string;
  notifyDesktop: boolean;
}

export function toPersistablePipelineConfig(input: {
  platform: ScraperPlatform;
  scope: ScrapeScope;
  requestedFields: string;
  containerClasses: string;
  useCache: boolean;
  allowInsecureTls: boolean;
  quickMediaMode: boolean;
  enableBackground: boolean;
  bgStateA: BackgroundEditorState;
  bgPositionsTextA: string;
  bgStateB: BackgroundEditorState;
  bgPositionsTextB: string;
  zoomPercent: number;
  canvasShape: CanvasShape;
  logoPosition: LogoPosition;
  logoCustomX: number;
  logoCustomY: number;
  logoSizePercent: number;
  logoMarginPercent: number;
  textOverlayEnabled: boolean;
  textOverlayText: string;
  textOverlayPosition: LogoPosition;
  textOverlayCustomX: number;
  textOverlayCustomY: number;
  textOverlaySizePercent: number;
  textOverlayMarginPercent: number;
  textOverlayColor: string;
  textOverlayHasBackground: boolean;
  textOverlayBackgroundColor: string;
  enableConversion: boolean;
  conversionUi: ConversionUiState;
  notifyWebhookUrl: string;
  notifyDesktop: boolean;
}): PersistablePipelineConfig {
  return {
    ...input,
    bgStateA: toPersistableBackgroundState(input.bgStateA),
    bgStateB: toPersistableBackgroundState(input.bgStateB),
  };
}

/** Rehydrates a saved preset back into full `BackgroundEditorState`s — `bgImageFile`/`bgImagePreviewUrl` come back empty (a `File` can't survive storage) and need re-adding by hand if that preset used the "Image" background mode. */
export function fromPersistablePipelineConfig(preset: PersistablePipelineConfig): {
  bgStateA: BackgroundEditorState;
  bgStateB: BackgroundEditorState;
} {
  return {
    bgStateA: { ...createDefaultBackgroundEditorState(), ...preset.bgStateA },
    bgStateB: { ...createDefaultBackgroundEditorState(), ...preset.bgStateB },
  };
}

export function loadPresets(): Record<string, PersistablePipelineConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PersistablePipelineConfig>;
  } catch {
    return {};
  }
}

export function savePreset(name: string, config: PersistablePipelineConfig): void {
  try {
    const presets = loadPresets();
    presets[name] = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage full or disabled — the preset just won't persist this session.
  }
}

export function deletePreset(name: string): void {
  try {
    const presets = loadPresets();
    delete presets[name];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // best-effort — see savePreset
  }
}
