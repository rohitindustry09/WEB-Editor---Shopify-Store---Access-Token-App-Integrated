import * as UTIF from "utif2";

export type ImageFormat = "original" | "auto" | "image/jpeg" | "image/png" | "image/webp";

export interface ConversionSettings {
  format: ImageFormat;
  quality: number; // 0–1, ignored for PNG (lossless) and "original"
  maxSizeBytes: number | null;
  resizeOverMegapixels: boolean;
  /** Forces every image to this exact width/height, overriding the megapixel-based resize. `null` when custom resize is off. */
  customResize: { width: number; height: number } | null;
}

export const MEGAPIXEL_LIMIT = 25_000_000;
const MIN_QUALITY = 0.35;
const QUALITY_STEP = 0.12;
const MAX_SIZE_ATTEMPTS = 6;

export interface ProcessedImage {
  blob: Blob;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
}

const EXTENSION_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Canvas can only reliably encode to these three — anything else (including
// "image/tiff" itself) falls back to PNG once we've had to decode/redraw.
const CANVAS_ENCODABLE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function isTiff(file: { filename: string; mimeType: string }): boolean {
  return file.mimeType === "image/tiff" || /\.tiff?$/i.test(file.filename);
}

/** Decodes a TIFF via a pure-JS decoder (no browser support for TIFF exists) into a drawable ImageBitmap. */
async function decodeTiffToImageBitmap(blob: Blob): Promise<ImageBitmap> {
  const buffer = await blob.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (ifds.length === 0) throw new Error("This TIFF file has no readable image data.");
  const ifd = ifds[0];
  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const imageData = new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height);
  return createImageBitmap(imageData);
}

async function decodeBitmap(file: { blob: Blob; filename: string; mimeType: string }): Promise<ImageBitmap> {
  if (isTiff(file)) return decodeTiffToImageBitmap(file.blob);
  return createImageBitmap(file.blob);
}

/**
 * Draws `source` scaled to exactly `targetWidth`×`targetHeight`. A single
 * `drawImage` downscale defaults to low-quality smoothing (blurry/aliased
 * output — the actual cause of "custom resize looks bad"), so this always
 * turns smoothing up to high. For a large reduction (more than 2x in one
 * pass), browsers' single-pass resampling still looks noticeably worse than
 * stepping down by halves first — the standard mipmap-style trick — so this
 * halves repeatedly until within 2x of the target before the final draw.
 */
// `OffscreenCanvas` throughout — never `document.createElement` — so this
// works identically on the main thread AND inside a Web Worker. See
// `convertWorker.ts`, which imports `processImage` to run conversion off
// the main thread, spread across one worker per CPU core (same pattern as
// the background customiser's own worker pool).
function drawResized(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): OffscreenCanvas {
  let currentSource = source;
  let currentWidth = sourceWidth;
  let currentHeight = sourceHeight;

  while (currentWidth > targetWidth * 2 && currentHeight > targetHeight * 2) {
    const nextWidth = Math.max(targetWidth, Math.round(currentWidth / 2));
    const nextHeight = Math.max(targetHeight, Math.round(currentHeight / 2));
    const stepCanvas = new OffscreenCanvas(nextWidth, nextHeight);
    const stepCtx = stepCanvas.getContext("2d");
    if (!stepCtx) break;
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = "high";
    stepCtx.drawImage(currentSource, 0, 0, nextWidth, nextHeight);
    currentSource = stepCanvas;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't render a canvas to convert images.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(currentSource, 0, 0, targetWidth, targetHeight);
  return canvas;
}

function canvasToBlob(canvas: OffscreenCanvas, mime: string, quality: number): Promise<Blob> {
  return canvas.convertToBlob({ type: mime, quality: mime === "image/png" ? undefined : quality });
}

function formatLabel(format: ImageFormat): string {
  if (format === "image/webp") return "WebP";
  if (format === "image/jpeg") return "JPEG";
  if (format === "image/png") return "PNG";
  if (format === "auto") return "Auto (PNG if transparent, else WebP)";
  return format;
}

/** A quick downsampled alpha check on an already-decoded bitmap — used only by "auto" format to decide PNG (lossless, keeps transparency) vs. WebP (lossy, smaller) per image, without a second decode of the source blob. */
function bitmapHasTransparency(bitmap: ImageBitmap): boolean {
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
}

/**
 * Converts one image blob according to the chosen format/quality, optionally
 * downscaling it if it exceeds the megapixel cap, and — if a max file size
 * was set — steps quality down until it fits (best effort; PNG is lossless
 * so it can't be shrunk this way). TIFF sources are decoded with a bundled
 * JS TIFF decoder first, since no browser can read TIFF natively.
 */
export async function processImage(
  file: { blob: Blob; filename: string; mimeType: string },
  settings: ConversionSettings,
): Promise<ProcessedImage> {
  // A max-size limit still needs to run through the quality-stepping loop
  // below even when nothing else changed — skipping straight to "kept as-is"
  // here silently ignored the KB cap whenever format was "original" and no
  // resize was requested.
  const alreadyWithinSizeCap = !settings.maxSizeBytes || file.blob.size <= settings.maxSizeBytes;

  // Kept-as-is with nothing to do at all — skip decoding entirely.
  if (settings.format === "original" && !settings.resizeOverMegapixels && !settings.customResize && alreadyWithinSizeCap) {
    return {
      blob: file.blob,
      filename: file.filename,
      mimeType: file.mimeType,
      width: 0,
      height: 0,
      originalSize: file.blob.size,
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeBitmap(file);
  } catch {
    if (settings.format === "original" && !settings.customResize) {
      // Can't decode this format at all (an unusual TIFF variant, a RAW/PSD
      // export, etc.), but nothing was actually asked of it beyond a
      // possible resize — pass it through unresized rather than failing.
      return {
        blob: file.blob,
        filename: file.filename,
        mimeType: file.mimeType,
        width: 0,
        height: 0,
        originalSize: file.blob.size,
      };
    }
    throw new Error(
      settings.customResize
        ? `"${file.filename}" can't be decoded, so it can't be resized.`
        : `"${file.filename}" can't be decoded, so it can't be converted to ${formatLabel(settings.format)}. ` +
          `Set the format to "Keep original" for this file instead.`,
    );
  }

  let width = bitmap.width;
  let height = bitmap.height;

  if (settings.resizeOverMegapixels && width * height > MEGAPIXEL_LIMIT) {
    const scale = Math.sqrt(MEGAPIXEL_LIMIT / (width * height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  // Custom resize is an explicit exact-size request — it wins over whatever
  // the megapixel cap computed above.
  if (settings.customResize) {
    width = Math.max(1, Math.round(settings.customResize.width));
    height = Math.max(1, Math.round(settings.customResize.height));
  }

  const requestedMime =
    settings.format === "original"
      ? file.mimeType
      : settings.format === "auto"
        ? bitmapHasTransparency(bitmap)
          ? "image/png"
          : "image/webp"
        : settings.format;
  const noConversionNeeded =
    settings.format === "original" && width === bitmap.width && height === bitmap.height && alreadyWithinSizeCap;
  if (noConversionNeeded) {
    bitmap.close();
    return {
      blob: file.blob,
      filename: file.filename,
      mimeType: file.mimeType,
      width,
      height,
      originalSize: file.blob.size,
    };
  }

  // Canvas can't emit TIFF (or anything outside png/jpeg/webp) — once a
  // redraw is unavoidable (resize, or the source was TIFF), fall back to
  // lossless PNG for "keep original" rather than mislabeling the output.
  const targetMime = CANVAS_ENCODABLE_MIME.has(requestedMime) ? requestedMime : "image/png";

  const canvas = drawResized(bitmap, bitmap.width, bitmap.height, width, height);
  bitmap.close();

  let quality = settings.quality;
  let outputBlob = await canvasToBlob(canvas, targetMime, quality);

  if (settings.maxSizeBytes && targetMime !== "image/png") {
    let attempts = 0;
    while (outputBlob.size > settings.maxSizeBytes && quality > MIN_QUALITY && attempts < MAX_SIZE_ATTEMPTS) {
      quality -= QUALITY_STEP;
      outputBlob = await canvasToBlob(canvas, targetMime, quality);
      attempts++;
    }
  }

  const ext = EXTENSION_FOR_MIME[targetMime] ?? "img";
  const baseName = file.filename.replace(/\.[^.]+$/, "");

  return {
    blob: outputBlob,
    filename: `${baseName}.${ext}`,
    mimeType: targetMime,
    width,
    height,
    originalSize: file.blob.size,
  };
}
