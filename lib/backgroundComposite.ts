/**
 * Two different ways to change an image's background, entirely in the
 * browser via Canvas — matching this app's established pattern (see
 * `imageProcessing.ts`, `backgroundRemoval.ts`): nothing is uploaded
 * anywhere, no server-side image library involved.
 *
 * - "color" / "gradient" / "image": draws a new layer BEHIND the
 *   foreground, then the foreground on top at its original size. This
 *   only does anything useful when the foreground already has a
 *   transparent background (e.g. the output of this app's own
 *   "Background remover" tool) — on an opaque photo the new layer just
 *   ends up fully hidden underneath it. The UI is expected to gate these
 *   modes behind `hasTransparency` for that reason.
 * - "replace-color": for an opaque photo instead — an in-place color
 *   swap (e.g. a white studio backdrop to some other flat color) rather
 *   than compositing a new layer at all. See `ColorReplaceBackground`.
 */

/**
 * `OffscreenCanvas` throughout this module (never `document.createElement`)
 * so every function here works identically on the main thread AND inside a
 * Web Worker — see `compositeWorker.ts`, which imports these same
 * functions to run compositing off the main thread. `Canvas2DContext`
 * covers both `getContext("2d")` return types, since only members common
 * to both (fillRect, drawImage, getImageData, ...) are ever used here.
 */
type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type GradientType = "linear" | "radial";
export type RadialPosition = "center" | "top" | "right" | "bottom" | "left" | "custom";
export type ImageFit = "cover" | "contain";

export interface SolidBackground {
  kind: "color";
  color: string;
}

export interface GradientBackground {
  kind: "gradient";
  gradientType: GradientType;
  colorStart: string;
  colorEnd: string;
  /** Linear only — degrees, 0 = left-to-right, increases clockwise. */
  angleDeg: number;
  /** Radial only — where the gradient is centered. */
  position: RadialPosition;
  /** Radial + position === "custom" only — 0-100, percent of canvas width/height. */
  customX: number;
  customY: number;
}

export interface ImageBackgroundConfig {
  kind: "image";
  image: Blob;
  fit: ImageFit;
  /** 1 = 100%, no extra zoom beyond what `fit` already computes. */
  zoom: number;
  /** -50..50, percent of canvas width/height, shifts the background image from center. */
  offsetXPercent: number;
  offsetYPercent: number;
}

/**
 * A different operation entirely from the other three — those all draw a
 * NEW layer behind a transparent foreground, which does nothing useful on
 * a photo that has no transparency (a plain product shot on a white
 * studio background, say). For that case, the useful operation is an
 * in-place color swap: find every pixel close to `sourceColor` and repaint
 * it as `targetColor`, leaving every other pixel — the product itself —
 * untouched. `tolerance` (0-100) is how far a pixel's color may drift from
 * `sourceColor` and still count as a match, since real photos never have
 * one single flat, sample-exact background color across every pixel
 * (compression artifacts, lighting falloff, anti-aliasing at edges).
 */
export interface ColorReplaceBackground {
  kind: "replace-color";
  sourceColor: string;
  targetColor: string;
  tolerance: number;
}

export type BackgroundConfig = SolidBackground | GradientBackground | ImageBackgroundConfig | ColorReplaceBackground;

/**
 * A single uniform size control for the foreground, centered on the
 * canvas — 100 is its own original size. Below 100 shrinks it, revealing
 * a margin evenly on every side; above 100 enlarges it past the canvas's
 * own edges, which crops it evenly on every side (canvas drawing clips
 * anything outside its bounds automatically). Applies to every
 * `BackgroundConfig` kind: for color/gradient/image, the margin reveals
 * that background; for "replace-color" (no separate background layer to
 * reveal), the margin is filled with that config's own `targetColor`
 * instead — see `compositeBackground`'s replace-color branch.
 */
export interface ForegroundZoom {
  zoomPercent: number;
}

const NO_ZOOM: ForegroundZoom = { zoomPercent: 100 };

/**
 * "original" (default) keeps the canvas at the source photo's own
 * dimensions, exactly as before this existed. "square" pads a non-square
 * photo out to a square canvas (the longer side becomes both dimensions)
 * instead of cropping — the foreground is centered on it the same way
 * `ForegroundZoom` already centers a shrunk foreground, so the two combine
 * naturally: a 100% zoom on a square canvas is just "center the original
 * photo and reveal whatever margin its own aspect ratio needs," no special
 * casing required. Applies uniformly across a batch, same scope as Zoom &
 * logo, not per-column.
 */
export type CanvasShape = "original" | "square";
const DEFAULT_CANVAS_SHAPE: CanvasShape = "original";

function canvasSizeFor(bitmapWidth: number, bitmapHeight: number, shape: CanvasShape): { width: number; height: number } {
  if (shape === "square") {
    const side = Math.max(bitmapWidth, bitmapHeight);
    return { width: side, height: side };
  }
  return { width: bitmapWidth, height: bitmapHeight };
}

export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "custom";

/**
 * A logo/watermark stamped on top of everything else — drawn last,
 * regardless of `BackgroundConfig` kind, so it always sits above the
 * background AND the product photo. Applies uniformly across a whole
 * batch: one logo, one position, stamped onto every processed image the
 * same way.
 */
export interface LogoOverlay {
  image: Blob;
  position: LogoPosition;
  /** Custom only — 0-100, percent of canvas width/height, the logo's own CENTER point (not its top-left corner). */
  customXPercent: number;
  customYPercent: number;
  /** The logo's own width as a percent of the canvas width — its height follows from its own aspect ratio. */
  sizePercent: number;
  /** Preset positions only (not center/custom) — how far to inset from the nearest edges, percent of the shorter canvas dimension. */
  marginPercent: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const value = parseInt(normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export interface AverageColor {
  r: number;
  g: number;
  b: number;
}

const CORNER_SAMPLE_CANVAS_SIZE = 32;
const CORNER_SAMPLE_BLOCK_RADIUS = 2;

/**
 * Downscales `blob` to a tiny canvas and averages its 4 corner blocks — a
 * coarse, cheap fingerprint of a composited image's actual background
 * color, not a precision measurement. Used to flag a batch's outliers (see
 * `compositeWorker.ts`'s own use of this): a background-swap batch should
 * end up with every result's corners reading roughly the same color, so
 * one whose corners land far from the rest of the batch's median is worth
 * a second look — a wrong column applied, a logo/zoom overlap, or a source
 * photo whose backdrop wasn't actually plain to begin with.
 */
export async function sampleCornerAverageColor(blob: Blob): Promise<AverageColor> {
  const bitmap = await createImageBitmap(blob);
  try {
    const size = CORNER_SAMPLE_CANVAS_SIZE;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { r: 0, g: 0, b: 0 };
    ctx.drawImage(bitmap, 0, 0, size, size);

    const r = CORNER_SAMPLE_BLOCK_RADIUS;
    const corners: [number, number][] = [
      [r, r],
      [size - 1 - r, r],
      [r, size - 1 - r],
      [size - 1 - r, size - 1 - r],
    ];
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    for (const [cx, cy] of corners) {
      const blockSize = r * 2 + 1;
      const data = ctx.getImageData(cx - r, cy - r, blockSize, blockSize).data;
      for (let i = 0; i < data.length; i += 4) {
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        count += 1;
      }
    }
    return { r: sumR / count, g: sumG / count, b: sumB / count };
  } finally {
    bitmap.close();
  }
}

export function averageColorDistance(a: AverageColor, b: AverageColor): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

const RADIAL_POSITION_PERCENT: Record<Exclude<RadialPosition, "custom">, { x: number; y: number }> = {
  center: { x: 50, y: 50 },
  top: { x: 50, y: 0 },
  right: { x: 100, y: 50 },
  bottom: { x: 50, y: 100 },
  left: { x: 0, y: 50 },
};

function paintSolid(ctx: Canvas2DContext, width: number, height: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

function paintLinearGradient(ctx: Canvas2DContext, width: number, height: number, bg: GradientBackground): void {
  // Build the gradient line from the canvas center, long enough that its
  // endpoints always land outside the canvas at any angle — otherwise a
  // steep angle on a wide/short canvas would clip the gradient short of one
  // of the corners.
  const angleRad = (bg.angleDeg * Math.PI) / 180;
  const halfDiagonal = Math.sqrt(width * width + height * height) / 2;
  const cx = width / 2;
  const cy = height / 2;
  const dx = Math.cos(angleRad) * halfDiagonal;
  const dy = Math.sin(angleRad) * halfDiagonal;

  const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  gradient.addColorStop(0, bg.colorStart);
  gradient.addColorStop(1, bg.colorEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function paintRadialGradient(ctx: Canvas2DContext, width: number, height: number, bg: GradientBackground): void {
  const { x: xPercent, y: yPercent } =
    bg.position === "custom" ? { x: bg.customX, y: bg.customY } : RADIAL_POSITION_PERCENT[bg.position];
  const cx = (xPercent / 100) * width;
  const cy = (yPercent / 100) * height;

  // Radius reaches the farthest corner from the chosen center, so the
  // gradient's outer color always fully covers the canvas regardless of
  // where the center sits.
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];
  const radius = Math.max(...corners.map((c) => Math.hypot(c.x - cx, c.y - cy)));

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, bg.colorStart);
  gradient.addColorStop(1, bg.colorEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function paintGradient(ctx: Canvas2DContext, width: number, height: number, bg: GradientBackground): void {
  if (bg.gradientType === "linear") paintLinearGradient(ctx, width, height, bg);
  else paintRadialGradient(ctx, width, height, bg);
}

/** Cover/contain draw geometry, same math as CSS `background-size`, plus an extra user zoom and a percent-based center offset. */
function computeImageDrawRect(
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  bg: ImageBackgroundConfig,
): { x: number; y: number; width: number; height: number } {
  const canvasRatio = canvasWidth / canvasHeight;
  const imageRatio = imageWidth / imageHeight;

  const fitScale =
    bg.fit === "cover"
      ? imageRatio > canvasRatio
        ? canvasHeight / imageHeight
        : canvasWidth / imageWidth
      : imageRatio > canvasRatio
        ? canvasWidth / imageWidth
        : canvasHeight / imageHeight;

  const scale = fitScale * Math.max(0.1, bg.zoom);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;

  const centerX = canvasWidth / 2 + (bg.offsetXPercent / 100) * canvasWidth;
  const centerY = canvasHeight / 2 + (bg.offsetYPercent / 100) * canvasHeight;

  return { x: centerX - drawWidth / 2, y: centerY - drawHeight / 2, width: drawWidth, height: drawHeight };
}

async function paintImage(ctx: Canvas2DContext, width: number, height: number, bg: ImageBackgroundConfig): Promise<void> {
  const bitmap = await createImageBitmap(bg.image);
  try {
    const rect = computeImageDrawRect(width, height, bitmap.width, bitmap.height, bg);
    // "Contain" can leave the canvas partly uncovered at the edges — fill
    // with the image's own edge-adjacent look isn't worth the complexity, a
    // plain white backstop is a sane default so those edges are never left
    // as leftover transparency in the final flattened output.
    if (bg.fit === "contain") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
  } finally {
    bitmap.close();
  }
}

interface OverlayPlacement {
  position: LogoPosition;
  customXPercent: number;
  customYPercent: number;
  marginPercent: number;
}

/** Places a `boxWidth` x `boxHeight` box per `placement` — shared geometry between the logo overlay (box = the logo's own aspect-scaled size) and the text overlay (box = the rendered text's measured size), so the two position identically instead of two hand-maintained copies of the same switch. */
function computeOverlayRect(
  canvasWidth: number,
  canvasHeight: number,
  boxWidth: number,
  boxHeight: number,
  placement: OverlayPlacement,
): { x: number; y: number; width: number; height: number } {
  const margin = (placement.marginPercent / 100) * Math.min(canvasWidth, canvasHeight);

  switch (placement.position) {
    case "top-left":
      return { x: margin, y: margin, width: boxWidth, height: boxHeight };
    case "top-right":
      return { x: canvasWidth - boxWidth - margin, y: margin, width: boxWidth, height: boxHeight };
    case "bottom-left":
      return { x: margin, y: canvasHeight - boxHeight - margin, width: boxWidth, height: boxHeight };
    case "bottom-right":
      return { x: canvasWidth - boxWidth - margin, y: canvasHeight - boxHeight - margin, width: boxWidth, height: boxHeight };
    case "center":
      return { x: (canvasWidth - boxWidth) / 2, y: (canvasHeight - boxHeight) / 2, width: boxWidth, height: boxHeight };
    case "custom":
    default: {
      const centerX = (placement.customXPercent / 100) * canvasWidth;
      const centerY = (placement.customYPercent / 100) * canvasHeight;
      return { x: centerX - boxWidth / 2, y: centerY - boxHeight / 2, width: boxWidth, height: boxHeight };
    }
  }
}

/** The logo's own draw rect — sized from `sizePercent` of the canvas width (height follows its own aspect ratio), placed per `position`. */
function computeLogoDrawRect(
  canvasWidth: number,
  canvasHeight: number,
  logoWidth: number,
  logoHeight: number,
  logo: LogoOverlay,
): { x: number; y: number; width: number; height: number } {
  const drawWidth = (logo.sizePercent / 100) * canvasWidth;
  const scale = drawWidth / logoWidth;
  const drawHeight = logoHeight * scale;
  return computeOverlayRect(canvasWidth, canvasHeight, drawWidth, drawHeight, logo);
}

async function paintLogo(ctx: Canvas2DContext, canvasWidth: number, canvasHeight: number, logo: LogoOverlay): Promise<void> {
  const bitmap = await createImageBitmap(logo.image);
  try {
    const rect = computeLogoDrawRect(canvasWidth, canvasHeight, bitmap.width, bitmap.height, logo);
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
  } finally {
    bitmap.close();
  }
}

/**
 * A text stamp ("New", a price tag, a batch label) — independent of, and
 * layered on top of, the logo overlay, same scope (applies to every image
 * regardless of background mode, drawn last). Shares its positioning with
 * the logo via `computeOverlayRect`, sized as a font-size percent of the
 * canvas width rather than an image's own pixel dimensions, since there's
 * no source image here to derive an aspect ratio from.
 */
export interface TextOverlay {
  text: string;
  position: LogoPosition;
  /** Custom only — 0-100, percent of canvas width/height, the text's own CENTER point. */
  customXPercent: number;
  customYPercent: number;
  /** Font size as a percent of canvas width. */
  sizePercent: number;
  /** Preset positions only (not center/custom) — how far to inset from the nearest edges, percent of the shorter canvas dimension. */
  marginPercent: number;
  color: string;
  /** A translucent backing box behind the text, for legibility over a busy background — omit for no backing at all. */
  backgroundColor?: string;
}

function paintTextOverlay(ctx: Canvas2DContext, canvasWidth: number, canvasHeight: number, overlay: TextOverlay): void {
  if (!overlay.text.trim()) return;
  const fontSizePx = Math.max(1, (overlay.sizePercent / 100) * canvasWidth);
  ctx.font = `bold ${fontSizePx}px sans-serif`;
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText(overlay.text);
  // A rough but serviceable line box — real font-metric ascent/descent
  // properties aren't available identically across every browser/worker
  // context this runs in, and this is only used for backing-box sizing and
  // centering, not pixel-perfect typography.
  const textWidth = metrics.width;
  const textHeight = fontSizePx * 1.2;
  const padding = fontSizePx * 0.35;

  const boxWidth = textWidth + padding * 2;
  const boxHeight = textHeight + padding * 2;
  const rect = computeOverlayRect(canvasWidth, canvasHeight, boxWidth, boxHeight, overlay);

  if (overlay.backgroundColor) {
    ctx.fillStyle = overlay.backgroundColor;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.fillStyle = overlay.color;
  ctx.fillText(overlay.text, rect.x + padding, rect.y + padding + fontSizePx * 0.85);
}

/**
 * The foreground's own draw rect once zoom has resized it — scaled
 * uniformly from `zoomPercent` and centered on the canvas. Canvas drawing
 * clips anything outside the canvas's own bounds automatically, so a
 * zoom-in that draws the foreground larger than the canvas needs no
 * special cropping logic here; it just happens.
 */
function computeForegroundDrawRect(
  canvasWidth: number,
  canvasHeight: number,
  foregroundWidth: number,
  foregroundHeight: number,
  zoom: ForegroundZoom,
): { x: number; y: number; width: number; height: number } {
  const MIN_SCALE = 0.05;
  const scale = Math.max(MIN_SCALE, zoom.zoomPercent / 100);
  const drawWidth = foregroundWidth * scale;
  const drawHeight = foregroundHeight * scale;

  return {
    x: (canvasWidth - drawWidth) / 2,
    y: (canvasHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function canvasToBlob(canvas: OffscreenCanvas): Promise<Blob> {
  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * Downscales `image` to at most `maxDimension` on its longer side — a
 * cheap, one-time cost meant to be paid ONCE per sample image, not on
 * every slider tick. The live preview is only ever shown at a few hundred
 * CSS pixels wide, so compositing against the image's full original
 * resolution on every interaction was pure waste: a real multi-megapixel
 * product photo, re-decoded and re-composited (including, for
 * "replace-color", a full per-pixel JS scan) tens of times a second while
 * dragging a slider, was enough to freeze the tab outright — confirmed as
 * the actual cause of reported lag. Compositing a ~480px proxy instead of
 * a 3000px original cuts the per-tick work by roughly two orders of
 * magnitude. The real, full-resolution image is still what the actual
 * batch processing (not just the preview) works from — this proxy is
 * preview-only.
 */
export async function createPreviewProxy(image: Blob, maxDimension = 480): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't render a canvas to build a preview.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}

// How much of the tolerance band, at its outer edge, is used to feather the
// replace/don't-replace boundary instead of cutting it sharply — a pixel
// right at the threshold distance used to flip from "fully replaced" to
// "fully untouched" with nothing in between, which is exactly what makes a
// hard-edged jagged boundary against anti-aliased product edges or noisy
// backdrop pixels. `FEATHER_MIN_DISTANCE` guarantees at least a couple of
// RGB-distance units of softening even at a very low tolerance, where
// `FEATHER_FRACTION * threshold` alone would round down to nothing.
const FEATHER_FRACTION = 0.15;
const FEATHER_MIN_DISTANCE = 6;

/**
 * Replaces pixels within `tolerance` of `sourceColor` with `targetColor`,
 * in place on `ctx`'s current contents. `tolerance` (0-100) is scaled to
 * the maximum possible RGB distance (a black-to-white diagonal, ~441) so
 * it reads as a simple 0-100 "how strict" slider rather than a raw,
 * unintuitive distance number.
 *
 * The boundary itself is feathered rather than a hard cutoff: a pixel just
 * inside the matched distance blends mostly toward `targetColor`, one just
 * outside blends mostly toward its own original color, with a smooth ramp
 * between — instead of two adjacent pixels one distance-unit apart
 * suddenly being fully-replaced and fully-untouched. This is what actually
 * smooths the jagged edge a hard threshold leaves along real photos, where
 * compression noise and anti-aliasing mean the backdrop-to-product
 * transition is never a single clean distance value.
 */
function replaceColor(ctx: Canvas2DContext, width: number, height: number, bg: ColorReplaceBackground): void {
  const source = hexToRgb(bg.sourceColor);
  const target = hexToRgb(bg.targetColor);
  const maxDistance = Math.sqrt(255 * 255 * 3);
  const threshold = (bg.tolerance / 100) * maxDistance;
  const featherBand = Math.max(threshold * FEATHER_FRACTION, FEATHER_MIN_DISTANCE);

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const dr = pixels[i] - source.r;
    const dg = pixels[i + 1] - source.g;
    const db = pixels[i + 2] - source.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance >= threshold + featherBand) continue; // clearly outside the match — untouched

    // 1 = fully replaced (well inside the matched region), 0 = fully
    // original (right at or past the outer edge of the feather band).
    const factor = distance <= threshold ? 1 : 1 - (distance - threshold) / featherBand;
    pixels[i] = pixels[i] * (1 - factor) + target.r * factor;
    pixels[i + 1] = pixels[i + 1] * (1 - factor) + target.g * factor;
    pixels[i + 2] = pixels[i + 2] * (1 - factor) + target.b * factor;
    // Alpha is left untouched — this operation only ever runs on images
    // that were already confirmed opaque, so there's nothing meaningful
    // to change there.
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Downsamples `image` onto a small canvas and checks whether any pixel has
 * partial or full transparency. Downsampling first (rather than scanning
 * every pixel of a full-resolution photo) keeps this cheap enough to run
 * on every image as the batch is loaded, and a real transparent region
 * survives the resize's own alpha blending almost certainly — an
 * approximate check is all this needs to be, since its only job is
 * choosing which UI controls to show.
 */
export async function hasTransparency(image: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(image);
  try {
    const SAMPLE_SIZE = 48;
    const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
    return false;
  } finally {
    bitmap.close();
  }
}

/** Reads the color of one pixel at `(x, y)` in `image`'s own natural (unscaled) coordinates — the eyedropper's actual sampling step. */
export async function samplePixelColor(image: Blob, x: number, y: number): Promise<string> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser can't render a canvas to sample a color.");
    ctx.drawImage(bitmap, 0, 0);
    const clampedX = Math.min(Math.max(Math.round(x), 0), bitmap.width - 1);
    const clampedY = Math.min(Math.max(Math.round(y), 0), bitmap.height - 1);
    const { data } = ctx.getImageData(clampedX, clampedY, 1, 1);
    return rgbToHex(data[0], data[1], data[2]);
  } finally {
    bitmap.close();
  }
}

/**
 * Composites `foreground` (expected to have a transparent background) onto
 * `config`'s background, at the foreground's own original canvas size —
 * resized by `zoom` when given one (ignored for "replace-color", see
 * `ForegroundZoom`) — then stamps `logo` on top of everything, when given
 * one, regardless of `config`'s kind. Returns a PNG blob — PNG because a
 * freshly-flattened photo composite has no reason to be lossy, and it's
 * the same output format this app's background remover already produces.
 */
export async function compositeBackground(
  foreground: Blob,
  config: BackgroundConfig,
  zoom: ForegroundZoom = NO_ZOOM,
  logo?: LogoOverlay,
  canvasShape: CanvasShape = DEFAULT_CANVAS_SHAPE,
  textOverlay?: TextOverlay,
): Promise<Blob> {
  const bitmap = await createImageBitmap(foreground);
  try {
    const { width, height } = canvasSizeFor(bitmap.width, bitmap.height, canvasShape);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't render a canvas to build the background.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // A square canvas is itself a reason the photo needs centering even at
    // 100% zoom — a non-square source no longer fills the (now larger)
    // canvas on every side the way it always did before `canvasShape`
    // existed, so "is there padding to reveal" can no longer be answered
    // by the zoom level alone.
    const needsCentering = zoom.zoomPercent !== 100 || canvas.width !== bitmap.width || canvas.height !== bitmap.height;

    if (config.kind === "replace-color") {
      // There's no separately-chosen background layer here to reveal as a
      // margin when zoomed out — but `targetColor` (what the matched
      // pixels get repainted to) already IS the color the user wants
      // showing, so it doing double duty as the margin fill is the
      // natural choice, not an arbitrary one. Filled first, then the
      // (possibly shrunk-and-centered, or enlarged-and-cropped) photo goes
      // on top; the color-replace pass runs over the whole canvas after,
      // but since the margin already exactly matches `targetColor`, it
      // isn't within `tolerance` of `sourceColor` and is left untouched.
      if (needsCentering) {
        ctx.fillStyle = config.targetColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const rect = computeForegroundDrawRect(canvas.width, canvas.height, bitmap.width, bitmap.height, zoom);
        ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
      } else {
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      }
      replaceColor(ctx, canvas.width, canvas.height, config);
      if (logo) await paintLogo(ctx, canvas.width, canvas.height, logo);
      if (textOverlay) paintTextOverlay(ctx, canvas.width, canvas.height, textOverlay);
      return await canvasToBlob(canvas);
    }

    if (config.kind === "color") paintSolid(ctx, canvas.width, canvas.height, config.color);
    else if (config.kind === "gradient") paintGradient(ctx, canvas.width, canvas.height, config);
    else await paintImage(ctx, canvas.width, canvas.height, config);

    const rect = computeForegroundDrawRect(canvas.width, canvas.height, bitmap.width, bitmap.height, zoom);
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    if (logo) await paintLogo(ctx, canvas.width, canvas.height, logo);
    if (textOverlay) paintTextOverlay(ctx, canvas.width, canvas.height, textOverlay);
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}

/**
 * Applies just `zoom` and `logo` to `image`, with no background change at
 * all — for images that weren't selected for a background swap but should
 * still get resized/watermarked along with the ones that were (the tool's
 * shot-number picker only scopes the background change; zoom and logo are
 * meant to apply uniformly across a whole batch). Any margin revealed by
 * zooming out is left transparent, same as this app's other transparent-
 * PNG outputs — there's no background config here to fill it with, and
 * inventing one (white, say) would be an unrequested guess.
 *
 * Returns the original blob completely untouched when there's nothing to
 * actually do (zoom at 100% and no logo) — the common case for the many
 * unselected images in a typical batch, and worth skipping the decode/
 * re-encode round trip for.
 */
export async function applyZoomAndLogo(
  image: Blob,
  zoom: ForegroundZoom,
  logo?: LogoOverlay,
  canvasShape: CanvasShape = DEFAULT_CANVAS_SHAPE,
  textOverlay?: TextOverlay,
): Promise<Blob> {
  // The "nothing to do, return the original blob untouched" shortcut can
  // only fire for `canvasShape === "original"` — squaring a non-square
  // photo is real work even at 100% zoom with no logo/text.
  if (zoom.zoomPercent === 100 && !logo && !textOverlay && canvasShape === "original") return image;

  const bitmap = await createImageBitmap(image);
  try {
    const { width, height } = canvasSizeFor(bitmap.width, bitmap.height, canvasShape);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't render a canvas to resize this image.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const rect = computeForegroundDrawRect(canvas.width, canvas.height, bitmap.width, bitmap.height, zoom);
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    if (logo) await paintLogo(ctx, canvas.width, canvas.height, logo);
    if (textOverlay) paintTextOverlay(ctx, canvas.width, canvas.height, textOverlay);
    return await canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}
