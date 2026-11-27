import { naturalCompare } from "./naturalSort";

/**
 * A from-scratch, streaming ZIP reader — deliberately not using the `jszip`
 * package, which reads the entire archive into memory up front. That falls
 * over on real-world exports (a multi-gigabyte "all product photos" zip
 * throws a browser-level "could not be read" error once it exceeds the
 * tab's memory ceiling).
 *
 * Instead this only ever holds two things in memory: the (tiny) central
 * directory listing every entry's name/size/location, and — one at a time,
 * only when actually requested — a single entry's compressed bytes, read
 * via `File.slice()` (a lazy byte-range view, not a read) and decompressed
 * with the browser's native `DecompressionStream`. Total memory use is
 * bounded by the largest single image in the zip, not the zip itself, so
 * the archive itself can be arbitrarily large.
 */

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65557; // 22-byte EOCD record + max 65535-byte comment

/**
 * A zip that lives on the server (a download saved from Google Drive), read lazily with HTTP range requests instead of
 * being brought into the browser whole. Deliberately plain data — no methods — so it can still be posted to a web worker,
 * exactly like a `File` can.
 */
export interface RemoteZipSource {
  kind: "remote";
  /** Same-origin address that serves the zip and honours `Range`. */
  url: string;
  size: number;
  name: string;
}

/** Where a zip's bytes come from: a file picked on this computer, or a saved copy on the server. */
export type ZipSource = File | RemoteZipSource;

const isRemote = (source: ZipSource): source is RemoteZipSource => "kind" in source && source.kind === "remote";

/** Bytes `[start, end)` of the zip as a Blob — a lazy slice for a local file, one range request for a server copy. */
async function readRange(source: ZipSource, start: number, end: number): Promise<Blob> {
  if (!isRemote(source)) return source.slice(start, end);
  if (end <= start) return new Blob([]);
  const response = await fetch(source.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
  const wholeFile = response.status === 200 && start === 0 && end >= source.size;
  if (response.status !== 206 && !wholeFile) throw new Error(`The saved zip couldn't be read (the server answered ${response.status}).`);
  return response.blob();
}

interface CentralDirEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  compressionMethod: number;
  isDir: boolean;
  /** CRC-32 of the UNCOMPRESSED data, straight from the central directory record — needed to copy this entry's raw bytes into a new zip without re-decompressing it just to recompute a checksum we already have. */
  crc: number;
}

export interface StreamingZipHandle {
  file: ZipSource;
  entriesByPath: Map<string, CentralDirEntry>;
}

async function findEndOfCentralDirectory(file: ZipSource): Promise<{ cdOffset: number; cdSize: number; entryCount: number }> {
  const searchSize = Math.min(file.size, MAX_EOCD_SEARCH);
  const tailStart = file.size - searchSize;
  const tail = new Uint8Array(await (await readRange(file, tailStart, file.size)).arrayBuffer());

  for (let i = tail.length - 22; i >= 0; i--) {
    if (new DataView(tail.buffer, tail.byteOffset + i).getUint32(0, true) !== EOCD_SIGNATURE) continue;

    const view = new DataView(tail.buffer, tail.byteOffset + i);
    let entryCount = view.getUint16(10, true);
    let cdSize = view.getUint32(12, true);
    let cdOffset = view.getUint32(16, true);

    // Standard EOCD fields are 32-bit — a Zip64 archive (very large, or
    // very many entries) marks them 0xFFFF/0xFFFFFFFF and stores the real
    // 64-bit values in a Zip64 EOCD record, found via a locator that
    // immediately precedes this record.
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locatorOffset = tailStart + i - 20;
      if (locatorOffset >= 0) {
        const locatorBuf = new Uint8Array(await (await readRange(file, locatorOffset, locatorOffset + 20)).arrayBuffer());
        const locatorView = new DataView(locatorBuf.buffer);
        if (locatorView.getUint32(0, true) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
          const zip64Offset = Number(locatorView.getBigUint64(8, true));
          const zip64Buf = new Uint8Array(await (await readRange(file, zip64Offset, zip64Offset + 56)).arrayBuffer());
          const zip64View = new DataView(zip64Buf.buffer);
          if (zip64View.getUint32(0, true) === ZIP64_EOCD_SIGNATURE) {
            entryCount = Number(zip64View.getBigUint64(32, true));
            cdSize = Number(zip64View.getBigUint64(40, true));
            cdOffset = Number(zip64View.getBigUint64(48, true));
          }
        }
      }
    }

    return { cdOffset, cdSize, entryCount };
  }

  throw new Error("This doesn't look like a valid zip file (no end-of-central-directory record found).");
}

function readZip64Extra(entry: { compressedSize: number; uncompressedSize: number; localHeaderOffset: number }, extra: Uint8Array): void {
  let pos = 0;
  while (pos + 4 <= extra.length) {
    const view = new DataView(extra.buffer, extra.byteOffset + pos);
    const headerId = view.getUint16(0, true);
    const dataSize = view.getUint16(2, true);
    if (headerId === 0x0001) {
      let zPos = pos + 4;
      const dataView = new DataView(extra.buffer, extra.byteOffset);
      if (entry.uncompressedSize === 0xffffffff) {
        entry.uncompressedSize = Number(dataView.getBigUint64(zPos, true));
        zPos += 8;
      }
      if (entry.compressedSize === 0xffffffff) {
        entry.compressedSize = Number(dataView.getBigUint64(zPos, true));
        zPos += 8;
      }
      if (entry.localHeaderOffset === 0xffffffff) {
        entry.localHeaderOffset = Number(dataView.getBigUint64(zPos, true));
        zPos += 8;
      }
    }
    pos += 4 + dataSize;
  }
}

async function parseCentralDirectory(file: ZipSource, cdOffset: number, cdSize: number, entryCount: number): Promise<CentralDirEntry[]> {
  const buf = new Uint8Array(await (await readRange(file, cdOffset, cdOffset + cdSize)).arrayBuffer());
  const decoder = new TextDecoder("utf-8");
  const entries: CentralDirEntry[] = [];
  let pos = 0;

  while (pos < buf.length && entries.length < entryCount) {
    const view = new DataView(buf.buffer, buf.byteOffset + pos);
    if (view.getUint32(0, true) !== CENTRAL_DIR_SIGNATURE) break;

    const compressionMethod = view.getUint16(10, true);
    const filenameLen = view.getUint16(28, true);
    const extraLen = view.getUint16(30, true);
    const commentLen = view.getUint16(32, true);

    const crc = view.getUint32(16, true);
    const entry = {
      compressedSize: view.getUint32(20, true),
      uncompressedSize: view.getUint32(24, true),
      localHeaderOffset: view.getUint32(42, true),
    };

    const filenameBytes = buf.subarray(pos + 46, pos + 46 + filenameLen);
    const path = decoder.decode(filenameBytes);

    if (entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff || entry.localHeaderOffset === 0xffffffff) {
      const extraBytes = buf.subarray(pos + 46 + filenameLen, pos + 46 + filenameLen + extraLen);
      readZip64Extra(entry, extraBytes);
    }

    entries.push({
      path,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      localHeaderOffset: entry.localHeaderOffset,
      compressionMethod,
      isDir: path.endsWith("/"),
      crc,
    });

    pos += 46 + filenameLen + extraLen + commentLen;
  }

  return entries;
}

/** Locates an entry's compressed byte range by reading past its own local file header (whose filename/extra field lengths can differ slightly from the central directory's copy). Shared by the decompressing and raw-passthrough readers below — both need exactly this, nothing more. */
async function locateEntryData(file: ZipSource, entry: CentralDirEntry): Promise<Blob> {
  const headerBuf = new Uint8Array(await (await readRange(file, entry.localHeaderOffset, entry.localHeaderOffset + 30)).arrayBuffer());
  const view = new DataView(headerBuf.buffer);
  if (view.getUint32(0, true) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Corrupt zip entry "${entry.path}" — local file header signature mismatch.`);
  }
  const filenameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + filenameLen + extraLen;
  return readRange(file, dataStart, dataStart + entry.compressedSize);
}

async function readEntryBlob(file: ZipSource, entry: CentralDirEntry): Promise<Blob> {
  const compressedBlob = await locateEntryData(file, entry);

  if (entry.compressionMethod === 0) {
    return compressedBlob;
  }
  if (entry.compressionMethod === 8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser can't decompress zip entries — try a recent Chrome, Edge, Firefox, or Safari.");
    }
    const decompressedStream = compressedBlob.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(decompressedStream).blob();
  }
  throw new Error(`"${entry.path}" uses an unsupported compression method — only stored or deflate zips are supported.`);
}

export interface SkuMediaFolder {
  sku: string;
  imageCount: number;
  filePaths: string[];
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i;

/**
 * macOS adds hidden helper files to a zip: a "__MACOSX" folder and, next to every
 * real file, a "._<name>" copy that only holds Finder metadata. They carry the
 * real image's extension (e.g. "._BHU4877A_1.webp") but are not images — counting
 * or uploading them doubles the image total and Shopify rejects each one with
 * "An unexpected error occurred".
 */
export function isMacMetadataPath(path: string): boolean {
  const segments = path.split(/[\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? "";
  return segments.includes("__MACOSX") || name.startsWith("._") || name === ".DS_Store";
}

export function isImageFilename(name: string): boolean {
  return IMAGE_EXTENSIONS.test(name) && !isMacMetadataPath(name);
}

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export function guessImageMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Reads a zip of `<SKU>/<image files>` folders and returns one entry per
 * top-level folder. Only the central directory is parsed here — no image
 * bytes are read until `readFolderImages` is called for a folder the user
 * actually chooses to work with.
 */
export async function loadSkuMediaZip(file: ZipSource): Promise<{ zip: StreamingZipHandle; folders: SkuMediaFolder[] }> {
  const { cdOffset, cdSize, entryCount } = await findEndOfCentralDirectory(file);
  const entries = await parseCentralDirectory(file, cdOffset, cdSize, entryCount);

  const entriesByPath = new Map<string, CentralDirEntry>();
  const bySku = new Map<string, string[]>();

  for (const entry of entries) {
    entriesByPath.set(entry.path, entry);
    if (entry.isDir) continue;
    if (!isImageFilename(entry.path)) continue;

    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length < 2) continue; // not inside a folder — no SKU to attribute it to
    // The SKU is the file's IMMEDIATE parent folder, not the zip's
    // top-level segment — those are only the same thing for a flat zip
    // (`SKU/image.jpg`). A zip built with one extra wrapper folder (e.g.
    // `store.com/SKU/image.jpg`, as some exports/downloads produce) used
    // to take segment[0] ("store.com") as if it were itself a single SKU,
    // silently merging every real product's images into one fake folder —
    // confirmed as the actual cause of a reported per-folder count bug.
    // Reading the parent-of-file instead is correct at any nesting depth.
    const sku = segments[segments.length - 2].trim();
    if (!sku) continue;

    const existing = bySku.get(sku) ?? [];
    existing.push(entry.path);
    bySku.set(sku, existing);
  }

  // Natural-sort so e.g. "img2.jpg" uploads before "img10.jpg" — the first
  // image after sorting is treated as the product's featured image.
  const folders = Array.from(bySku.entries()).map(([sku, filePaths]) => ({
    sku,
    imageCount: filePaths.length,
    filePaths: [...filePaths].sort((a, b) => naturalCompare(a, b)),
  }));

  return { zip: { file, entriesByPath }, folders };
}

/**
 * Reads a zip of images with no assumptions about folder structure — every
 * image file anywhere in the archive, flat, natural-sorted. Used by the
 * standalone media converter, which (unlike the product uploader) has no SKU
 * folders to group by, just "convert whatever's in here."
 */
export async function loadImageZip(file: ZipSource): Promise<{ zip: StreamingZipHandle; imagePaths: string[] }> {
  const { cdOffset, cdSize, entryCount } = await findEndOfCentralDirectory(file);
  const entries = await parseCentralDirectory(file, cdOffset, cdSize, entryCount);

  const entriesByPath = new Map<string, CentralDirEntry>();
  const imagePaths: string[] = [];
  for (const entry of entries) {
    entriesByPath.set(entry.path, entry);
    if (entry.isDir) continue;
    if (!isImageFilename(entry.path)) continue;
    imagePaths.push(entry.path);
  }
  imagePaths.sort((a, b) => naturalCompare(a, b));

  return { zip: { file, entriesByPath }, imagePaths };
}

export interface ZipImageFile {
  /** Full path within the zip — only populated by `readFolderImages`/`readZipImage`, not by other producers of this shape (e.g. `ProcessedImage`). */
  path?: string;
  filename: string;
  blob: Blob;
  mimeType: string;
}

/** Reads the actual image bytes for a set of zip entries, as browser Blobs ready to upload — one entry's bytes at a time, never the whole archive. */
export async function readFolderImages(zip: StreamingZipHandle, filePaths: string[]): Promise<ZipImageFile[]> {
  const files: ZipImageFile[] = [];
  for (const path of filePaths) {
    const entry = zip.entriesByPath.get(path);
    if (!entry) continue;
    const blob = await readEntryBlob(zip.file, entry);
    const filename = path.split("/").pop() ?? path;
    files.push({ path, filename, blob, mimeType: guessImageMimeType(filename) });
  }
  return files;
}

/** Reads a single entry's bytes by its full path in the zip. */
export async function readZipImage(zip: StreamingZipHandle, path: string): Promise<ZipImageFile | null> {
  const [file] = await readFolderImages(zip, [path]);
  return file ?? null;
}

export interface RawZipEntry {
  path: string;
  /** Still deflate-compressed (or stored, if `compressionMethod` is 0) — never decoded. */
  compressed: Blob;
  compressionMethod: number;
  crc: number;
  uncompressedSize: number;
}

/**
 * Reads an entry's compressed bytes straight through — no
 * `DecompressionStream` pass at all. For a caller that's about to write
 * this same entry into a NEW zip unchanged, decompressing it (and then, in
 * the writer, recompressing it) is pure wasted work: full CPU cost for
 * both directions, and a full copy of the image's raw pixel data
 * transiently resident in memory, for every single untouched file. A real
 * batch of a few thousand images, most of them untouched, made that add up
 * to enough peak memory to crash the tab outright — confirmed as the
 * actual cause, not a hypothetical. Passing the already-compressed bytes
 * straight through to a zip writer that also supports raw passthrough
 * (see `ZipWriterEntry` in `zipWriter.ts`) skips both directions entirely.
 */
export async function readRawZipEntry(zip: StreamingZipHandle, path: string): Promise<RawZipEntry | null> {
  const entry = zip.entriesByPath.get(path);
  if (!entry) return null;
  const compressed = await locateEntryData(zip.file, entry);
  return {
    path,
    compressed,
    compressionMethod: entry.compressionMethod,
    crc: entry.crc,
    uncompressedSize: entry.uncompressedSize,
  };
}
