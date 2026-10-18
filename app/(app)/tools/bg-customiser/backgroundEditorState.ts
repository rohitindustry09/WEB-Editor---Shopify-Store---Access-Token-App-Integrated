import type { BackgroundConfig, GradientType, ImageFit, RadialPosition } from "@/lib/backgroundComposite";

export type BgKind = "color" | "gradient" | "image" | "replace-color";

/** Everything one column's background picker needs — Column A and Column B each own one of these, fully independently. */
export interface BackgroundEditorState {
  bgKind: BgKind;
  solidColor: string;
  gradientType: GradientType;
  colorStart: string;
  colorEnd: string;
  angleDeg: number;
  radialPosition: RadialPosition;
  customX: number;
  customY: number;
  bgImageFile: File | null;
  bgImagePreviewUrl: string | null;
  imageFit: ImageFit;
  imageZoomPercent: number;
  imageOffsetX: number;
  imageOffsetY: number;
  replaceSourceColor: string;
  replaceTargetColor: string;
  replaceTolerance: number;
}

export function createDefaultBackgroundEditorState(): BackgroundEditorState {
  return {
    bgKind: "color",
    solidColor: "#f4f4f4",
    gradientType: "linear",
    colorStart: "#6366f1",
    colorEnd: "#f4f4f4",
    angleDeg: 90,
    radialPosition: "center",
    customX: 50,
    customY: 50,
    bgImageFile: null,
    bgImagePreviewUrl: null,
    imageFit: "cover",
    imageZoomPercent: 100,
    imageOffsetX: 0,
    imageOffsetY: 0,
    replaceSourceColor: "#ffffff",
    replaceTargetColor: "#000000",
    replaceTolerance: 30,
  };
}

/**
 * `bgKind` is just the user's last explicit click, which can go stale the
 * moment the sample image (and therefore its transparency) changes
 * underneath it — color/gradient/image modes are meaningless on an opaque
 * photo (see backgroundComposite.ts), and replace-color is meaningless on
 * a transparent one. Computed rather than "corrected" via a
 * setState-in-effect, so there's no extra render pass and no risk of
 * fighting the user's own next click.
 */
export function effectiveBgKindFor(bgKind: BgKind, sampleTransparent: boolean | null): BgKind {
  if (sampleTransparent === true && bgKind === "replace-color") return "color";
  if (sampleTransparent === false && bgKind !== "replace-color") return "replace-color";
  return bgKind;
}

export function backgroundConfigFor(state: BackgroundEditorState, effectiveBgKind: BgKind): BackgroundConfig {
  if (effectiveBgKind === "color") return { kind: "color", color: state.solidColor };
  if (effectiveBgKind === "gradient") {
    return {
      kind: "gradient",
      gradientType: state.gradientType,
      colorStart: state.colorStart,
      colorEnd: state.colorEnd,
      angleDeg: state.angleDeg,
      position: state.radialPosition,
      customX: state.customX,
      customY: state.customY,
    };
  }
  if (effectiveBgKind === "replace-color") {
    return { kind: "replace-color", sourceColor: state.replaceSourceColor, targetColor: state.replaceTargetColor, tolerance: state.replaceTolerance };
  }
  return {
    kind: "image",
    image: state.bgImageFile ?? new Blob(),
    fit: state.imageFit,
    zoom: state.imageZoomPercent / 100,
    offsetXPercent: state.imageOffsetX,
    offsetYPercent: state.imageOffsetY,
  };
}
