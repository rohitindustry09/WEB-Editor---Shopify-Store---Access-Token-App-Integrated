import * as UTIF from "utif2";

/**
 * "image/jpeg" and "image/jpg" are the same JPEG encoding; they differ only in the file extension written
 * (.jpeg or .jpg). "image/jpg" is an internal choice for the dropdown, never sent anywhere as a MIME type.
 */
export type ImageFormat = "original" | "auto" | "image/jpeg" | "image/jpg" | "image/png" | "image/webp";

export interface ConversionSettings {
  format: ImageFormat;
  quality: number; // 0–1, ignored for PNG (lossless) and "original"
  maxSizeBytes: number | null;
  resizeOverMegapixels: boolean;
  /** Forces every image to this exact width/height, overriding the megapixel-based resize. `null` when custom resize is off. */
  customResize: { width: number; height: number } | null;
}

export const MEGAPIXEL_LIMIT = 25_000_000;

/**
 * The size that keeps the aspect ratio and never goes over the megapixel limit. Both sides are rounded DOWN, so the
 * result can't land a few pixels over the cap the way rounding to nearest could.
 */
export function fitWithinMegapixels(width: number, height: number, limit: number = MEGAPIXEL_LIMIT): { width: number; height: number } {
  if (width * height <= limit) return { width, height };
  const scale = Math.sqrt(limit / (width * height));
  let fitWidth = Math.max(1, Math.floor(width * scale));
  let fitHeight = Math.max(1, Math.floor(height * scale));
  // Guard against floating-point edge cases: trim the longer side until it is certainly within the limit.
  while (fitWidth * fitHeight > limit && (fitWidth > 1 || fitHeight > 1)) {
    if (fitWidth >= fitHeight) fitWidth -= 1;
    else fitHeight -= 1;
  }
  return { width: fitWidth, height: fitHeight };
}

const HEADER_BYTES = 512 * 1024;

/**
 * An image's pixel size read from its file header (JPEG, PNG or WebP) — without decoding it, which for a huge image
 * is the expensive, memory-hungry part. Null when the format isn't recognised or the header isn't in the first 512 KB.
 */
export async function readImageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  const bytes = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  const view = new DataView(bytes.buffer);
  // PNG: signature, then the IHDR chunk holds width and height as big-endian 32-bit numbers.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the segments until a start-of-frame marker, which holds height then width.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      offset += 2 + view.getUint16(offset + 2);
    }
    return null;
  }
  // WebP: a RIFF container whose first chunk is VP8X (extended), VP8L (lossless) or VP8 (lossy).
  if (bytes.length >= 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (kind === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
    if (kind === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (kind === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  return null;
}
/** An undecodable file bigger than this is refused (not passed through) when the megapixel cap is on, because it might be over the cap. */
const UNVERIFIED_PASSTHROUGH_MAX_BYTES = 8 * 1024 * 1024;
const MIN_QUALITY = 0.35;
/** How many in-between qualities are tried when looking for the best one under the size cap. */
const SIZE_SEARCH_STEPS = 3;

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

/**
 * The extension for the output file. The explicit JPEG choices decide it (JPG → .jpg, JPEG → .jpeg); when the
 * format was not chosen explicitly a JPEG keeps the extension style the source file already had.
 */
function extensionFor(mime: string, format: ImageFormat, sourceName: string): string {
  if (mime !== "image/jpeg") return EXTENSION_FOR_MIME[mime] ?? "img";
  if (format === "image/jpg") return "jpg";
  if (format === "image/jpeg") return "jpeg";
  return /\.jpeg$/i.test(sourceName) ? "jpeg" : "jpg";
}

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
 * Decodes an image, with a way out for very large ones: a full-size decode of a huge photo can fail (it needs hundreds
 * of megabytes), but the browser can decode it straight to a smaller size. So when the normal decode fails and the
 * header says the image is over the megapixel limit, it is decoded directly at the size it will be saved at.
 */
async function decodeForSettings(file: { blob: Blob; filename: string; mimeType: string }, settings: ConversionSettings): Promise<ImageBitmap | null> {
  try {
    return await decodeBitmap(file);
  } catch {
    // fall through to the downscaled decode
  }
  if (!settings.resizeOverMegapixels || isTiff(file)) return null;
  const size = await readImageSize(file.blob).catch(() => null);
  if (!size || size.width * size.height <= MEGAPIXEL_LIMIT) return null;
  const target = fitWithinMegapixels(size.width, size.height);
  try {
    return await createImageBitmap(file.blob, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" });
  } catch {
    return null;
  }
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

/**
 * JPEG has no transparency, and a canvas encodes transparent pixels as black — a cut-out product on a clear
 * background would come out on black. Paint the image onto white first, which is what a white-background
 * product photo is expected to look like.
 */
function flattenOnWhite(source: OffscreenCanvas): OffscreenCanvas {
  const flat = new OffscreenCanvas(source.width, source.height);
  const ctx = flat.getContext("2d");
  if (!ctx) return source;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(source, 0, 0);
  return flat;
}

function canvasToBlob(canvas: OffscreenCanvas, mime: string, quality: number): Promise<Blob> {
  return canvas.convertToBlob({ type: mime, quality: mime === "image/png" ? undefined : quality });
}

function formatLabel(format: ImageFormat): string {
  if (format === "image/webp") return "WebP";
  if (format === "image/jpeg") return "JPEG";
  if (format === "image/jpg") return "JPG";
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

  const decoded = await decodeForSettings(file, settings);
  let bitmap: ImageBitmap;
  if (decoded) {
    bitmap = decoded;
  } else {
    // A file this big can't be checked against the limit, so it must not slip through as if it had been (a small one can't be over it).
    const couldBeOversize = settings.resizeOverMegapixels && file.blob.size > UNVERIFIED_PASSTHROUGH_MAX_BYTES;
    if (settings.format === "original" && !settings.customResize && !couldBeOversize) {
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
        : couldBeOversize
          ? `"${file.filename}" is too large for this browser to open, so it couldn't be checked against the ${MEGAPIXEL_LIMIT / 1_000_000} megapixel limit and was not converted. Resize it first.`
          : `"${file.filename}" can't be decoded, so it can't be converted to ${formatLabel(settings.format)}. ` +
            `Set the format to "Keep original" for this file instead.`,
    );
  }

  let width = bitmap.width;
  let height = bitmap.height;

  if (settings.resizeOverMegapixels && width * height > MEGAPIXEL_LIMIT) {
    ({ width, height } = fitWithinMegapixels(width, height));
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
        : settings.format === "image/jpg"
          ? "image/jpeg"
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

  const drawn = drawResized(bitmap, bitmap.width, bitmap.height, width, height);
  bitmap.close();
  const canvas = targetMime === "image/jpeg" ? flattenOnWhite(drawn) : drawn;

  let outputBlob = await canvasToBlob(canvas, targetMime, settings.quality);

  // Meeting a size cap. Every encode of a large picture takes seconds, so the number of encodes matters more than
  // anything else here: try the lowest allowed quality once — if even that is over the cap, no quality in between can
  // meet it and the search stops straight away (the old stepping loop re-encoded six more times for nothing). Otherwise
  // a short binary search lands on the highest quality that fits.
  const cap = settings.maxSizeBytes;
  if (cap && targetMime !== "image/png" && outputBlob.size > cap) {
    const floorBlob = await canvasToBlob(canvas, targetMime, MIN_QUALITY);
    outputBlob = floorBlob;
    if (floorBlob.size <= cap) {
      let low = MIN_QUALITY;
      let high = settings.quality;
      for (let step = 0; step < SIZE_SEARCH_STEPS; step++) {
        const mid = (low + high) / 2;
        const candidate = await canvasToBlob(canvas, targetMime, mid);
        if (candidate.size <= cap) {
          outputBlob = candidate;
          low = mid;
        } else {
          high = mid;
        }
      }
    }
  }

  const ext = extensionFor(targetMime, settings.format, file.filename);
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
