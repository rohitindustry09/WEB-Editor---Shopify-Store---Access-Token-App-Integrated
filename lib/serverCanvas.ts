import "server-only";
import { Canvas, Image, ImageData as NapiImageData, loadImage } from "@napi-rs/canvas";

/**
 * Lets the browser image code run on the server. `backgroundComposite.ts` and `imageProcessing.ts` are written against
 * `OffscreenCanvas` and `createImageBitmap` (so they work inside a Web Worker); Node has neither. This installs small
 * stand-ins on top of Skia (`@napi-rs/canvas`, the same engine Chrome draws with) so the SAME code produces the server's
 * output — what the live preview shows is what the server job makes.
 *
 * Call `installServerCanvas()` once before using those modules; it is safe to call repeatedly.
 */

type EncodeFormat = "png" | "jpeg" | "webp";

/** A drawable picture decoded from bytes (what `createImageBitmap` hands back in a browser). */
interface BitmapLike {
  width: number;
  height: number;
  close(): void;
}

const MIME_TO_FORMAT: Record<string, EncodeFormat> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/webp": "webp",
};

/** An `OffscreenCanvas` that is also a real Skia canvas, so `ctx.drawImage(thisCanvas)` works exactly as in a browser. */
class ServerOffscreenCanvas extends Canvas {
  constructor(width: number, height: number) {
    super(width, height);
  }

  async convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> {
    const type = options?.type ?? "image/png";
    const format = MIME_TO_FORMAT[type] ?? "png";
    const quality = Math.round(Math.min(1, Math.max(0, options?.quality ?? 0.92)) * 100);
    const bytes = format === "png" ? await this.encode("png") : await this.encode(format, quality);
    return new Blob([new Uint8Array(bytes)], { type: `image/${format}` });
  }

  close(): void {
    // Nothing to release: Skia frees the canvas when it is garbage collected.
  }
}

/** Decodes bytes and gives the result the `close()` a browser ImageBitmap has. */
async function decode(blob: Blob): Promise<Image & BitmapLike> {
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
  Object.defineProperty(image, "close", { value: () => undefined, configurable: true });
  return image as Image & BitmapLike;
}

interface ResizeOptions {
  resizeWidth?: number;
  resizeHeight?: number;
}

async function createImageBitmapShim(source: Blob | ImageData, options?: ResizeOptions): Promise<BitmapLike> {
  if (source instanceof Blob) {
    const image = await decode(source);
    if (!options?.resizeWidth && !options?.resizeHeight) return image;
    const width = options.resizeWidth ?? Math.round((image.width / image.height) * (options.resizeHeight as number));
    const height = options.resizeHeight ?? Math.round((image.height / image.width) * (options.resizeWidth as number));
    const canvas = new ServerOffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  }
  const canvas = new ServerOffscreenCanvas(source.width, source.height);
  canvas.getContext("2d").putImageData(source as unknown as InstanceType<typeof NapiImageData>, 0, 0);
  return canvas;
}

let installed = false;

export function installServerCanvas(): void {
  if (installed) return;
  const target = globalThis as Record<string, unknown>;
  target.OffscreenCanvas = ServerOffscreenCanvas;
  target.createImageBitmap = createImageBitmapShim;
  if (typeof target.ImageData === "undefined") target.ImageData = NapiImageData;
  installed = true;
}
