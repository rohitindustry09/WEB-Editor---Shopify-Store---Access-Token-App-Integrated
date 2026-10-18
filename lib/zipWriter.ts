/**
 * A from-scratch, streaming-friendly ZIP writer — the write-side counterpart
 * of `skuMediaZip.ts`'s custom reader. Builds a standard PKZIP archive
 * (deflate compression, UTF-8 filenames) entirely client-side, so the media
 * converter can hand the user a single downloadable zip without any server
 * round trip. Falls back to Zip64 records automatically for an archive (or a
 * single entry) too large for the classic 32-bit fields.
 */

import { mapWithConcurrency } from "./concurrency";

export const LOCAL_FILE_SIGNATURE = 0x04034b50;
export const CENTRAL_DIR_SIGNATURE = 0x02014b50;
export const ZIP64_EOCD_SIGNATURE = 0x06064b50;
export const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
export const EOCD_SIGNATURE = 0x06054b50;
export const ZIP64_EXTRA_ID = 0x0001;
export const UTF8_FLAG = 0x0800;
export const NEEDS_ZIP64 = 0xffffffff;

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// TypeScript's DOM lib types `Uint8Array` as generic over `ArrayBufferLike`,
// which `Blob`'s constructor doesn't accept directly — copy each chunk out
// to a plain `ArrayBuffer` (which every Uint8Array here already owns
// exclusively) so it satisfies `BlobPart` without an unsound cast.
function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export interface ZipWriterBlobEntry {
  path: string;
  blob: Blob;
}

/**
 * A passthrough entry — bytes already compressed (or already stored, for
 * `compressionMethod === 0`) elsewhere, typically read straight out of
 * another zip via `readRawZipEntry`. Skips both the decompress-on-read and
 * recompress-on-write work entirely, which matters a lot at real batch
 * scale: recompressing a few thousand untouched images just to write them
 * back out unchanged was enough to crash a tab outright — confirmed as a
 * real, reproduced cause, not a theoretical one.
 */
export interface ZipWriterRawEntry {
  path: string;
  raw: {
    compressed: Blob;
    compressionMethod: number;
    crc: number;
    uncompressedSize: number;
  };
}

export type ZipWriterEntry = ZipWriterBlobEntry | ZipWriterRawEntry;

function isRawEntry(entry: ZipWriterEntry): entry is ZipWriterRawEntry {
  return "raw" in entry;
}

interface PreparedEntry {
  path: string;
  nameBytes: Uint8Array;
  compressed: Uint8Array;
  compressionMethod: number;
  crc: number;
  uncompressedSize: number;
  offset: number;
}

interface PreppedEntry {
  path: string;
  nameBytes: Uint8Array;
  compressed: Uint8Array;
  compressionMethod: number;
  crc: number;
  uncompressedSize: number;
}

// Deflate (and, for a raw entry, just reading the Blob's bytes) is
// per-entry-independent work with no dependency on any other entry — doing
// it one entry at a time in a straight `for` loop meant thousands of small
// `await`s serialized end to end, each paying its own microtask/stream
// overhead. At real scale (a multi-thousand-image export) that serial
// chain was slow enough to look hung. Preparing entries concurrently
// (bounded, so it doesn't try to hold thousands of decoded images in
// memory at once) cuts wall time by roughly the concurrency factor with no
// change in output.
const PREP_CONCURRENCY = 8;

async function prepEntry(entry: ZipWriterEntry, encoder: TextEncoder): Promise<PreppedEntry> {
  let compressed: Uint8Array;
  let crc: number;
  let uncompressedSize: number;
  let compressionMethod: number;

  if (isRawEntry(entry)) {
    compressed = new Uint8Array(await entry.raw.compressed.arrayBuffer());
    crc = entry.raw.crc;
    uncompressedSize = entry.raw.uncompressedSize;
    compressionMethod = entry.raw.compressionMethod;
  } else {
    // STORED, not DEFLATEd — every caller of `createZipBlob` (background
    // customiser, background remover, media converter) only ever hands it
    // already-compressed image bytes (PNG/WEBP/JPEG/...). Deflating an
    // already-compressed image shrinks it by close to nothing but still
    // costs the full CPU price of compressing it, which is exactly what
    // made "Zipping" look finished (every entry already collected) while
    // the tab kept grinding silently for a long stretch afterward — this
    // was that stretch. Matches the same STORED-only reasoning already
    // used for streamed zips in `lib/storeScraper/zipStream.ts`.
    const original = new Uint8Array(await entry.blob.arrayBuffer());
    crc = crc32(original);
    compressed = original;
    uncompressedSize = original.length;
    compressionMethod = 0;
  }

  return { path: entry.path, nameBytes: encoder.encode(entry.path), compressed, compressionMethod, crc, uncompressedSize };
}

export class ZipCancelledError extends Error {
  constructor() {
    super("Zip build cancelled.");
    this.name = "ZipCancelledError";
  }
}

/**
 * Builds a zip file from a list of entries — each either a {path, blob}
 * (written through STORED, uncompressed — see `prepEntry`'s own note on
 * why) or a {path, raw} passthrough (written through untouched, see
 * `ZipWriterRawEntry`). `onProgress` fires after each entry is prepared, so
 * a caller can show "N / total". `shouldCancel`, when given, is polled
 * between entries — a true rejects with `ZipCancelledError` instead of
 * finishing the build, letting a caller offer a real Cancel button during
 * what can otherwise be a long, silent-looking finalize pass.
 */
export async function createZipBlob(
  entries: ZipWriterEntry[],
  onProgress?: (done: number, total: number) => void,
  shouldCancel?: () => boolean,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const prepared: PreparedEntry[] = [];
  let offset = 0;
  let doneCount = 0;

  const prepped = await mapWithConcurrency(entries, PREP_CONCURRENCY, async (entry) => {
    if (shouldCancel?.()) throw new ZipCancelledError();
    const result = await prepEntry(entry, encoder);
    doneCount += 1;
    onProgress?.(doneCount, entries.length);
    return result;
  });

  // Byte offsets depend on every earlier entry's final size, so this pass
  // — unlike the preparation above — has to stay a strictly ordered loop.
  // It's cheap (pure in-memory layout, no async work), so that's fine.
  for (const entry of prepped) {
    const { compressed, crc, uncompressedSize, compressionMethod, nameBytes } = entry;
    const useZip64 = compressed.length >= NEEDS_ZIP64 || uncompressedSize >= NEEDS_ZIP64 || offset >= NEEDS_ZIP64;

    const extra = useZip64 ? buildZip64LocalExtra(uncompressedSize, compressed.length) : new Uint8Array(0);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, LOCAL_FILE_SIGNATURE, true);
    header.setUint16(4, useZip64 ? 45 : 20, true);
    header.setUint16(6, UTF8_FLAG, true);
    header.setUint16(8, compressionMethod, true);
    header.setUint16(10, 0, true); // mod time
    header.setUint16(12, 0, true); // mod date
    header.setUint32(14, crc, true);
    header.setUint32(18, useZip64 ? NEEDS_ZIP64 : compressed.length, true);
    header.setUint32(22, useZip64 ? NEEDS_ZIP64 : uncompressedSize, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, extra.length, true);

    parts.push(header.buffer, toBlobPart(nameBytes), toBlobPart(extra), toBlobPart(compressed));
    prepared.push({ path: entry.path, nameBytes, compressed, compressionMethod, crc, uncompressedSize, offset });
    offset += 30 + nameBytes.length + extra.length + compressed.length;
  }

  const cdStart = offset;
  for (const entry of prepared) {
    const useZip64 =
      entry.compressed.length >= NEEDS_ZIP64 || entry.uncompressedSize >= NEEDS_ZIP64 || entry.offset >= NEEDS_ZIP64;
    const extra = useZip64 ? buildZip64CentralExtra(entry.uncompressedSize, entry.compressed.length, entry.offset) : new Uint8Array(0);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, CENTRAL_DIR_SIGNATURE, true);
    header.setUint16(4, useZip64 ? 45 : 20, true); // version made by
    header.setUint16(6, useZip64 ? 45 : 20, true); // version needed
    header.setUint16(8, UTF8_FLAG, true);
    header.setUint16(10, entry.compressionMethod, true);
    header.setUint16(12, 0, true);
    header.setUint16(14, 0, true);
    header.setUint32(16, entry.crc, true);
    header.setUint32(20, useZip64 ? NEEDS_ZIP64 : entry.compressed.length, true);
    header.setUint32(24, useZip64 ? NEEDS_ZIP64 : entry.uncompressedSize, true);
    header.setUint16(28, entry.nameBytes.length, true);
    header.setUint16(30, extra.length, true);
    header.setUint16(32, 0, true); // comment length
    header.setUint16(34, 0, true); // disk number start
    header.setUint16(36, 0, true); // internal attrs
    header.setUint32(38, 0, true); // external attrs
    header.setUint32(42, useZip64 ? NEEDS_ZIP64 : entry.offset, true);

    parts.push(header.buffer, toBlobPart(entry.nameBytes), toBlobPart(extra));
    offset += 46 + entry.nameBytes.length + extra.length;
  }
  const cdSize = offset - cdStart;

  const needsZip64Eocd = prepared.length >= 0xffff || cdSize >= NEEDS_ZIP64 || cdStart >= NEEDS_ZIP64;
  if (needsZip64Eocd) {
    const zip64Eocd = new DataView(new ArrayBuffer(56));
    zip64Eocd.setUint32(0, ZIP64_EOCD_SIGNATURE, true);
    zip64Eocd.setBigUint64(4, BigInt(44), true);
    zip64Eocd.setUint16(12, 45, true);
    zip64Eocd.setUint16(14, 45, true);
    zip64Eocd.setUint32(16, 0, true);
    zip64Eocd.setUint32(20, 0, true);
    zip64Eocd.setBigUint64(24, BigInt(prepared.length), true);
    zip64Eocd.setBigUint64(32, BigInt(prepared.length), true);
    zip64Eocd.setBigUint64(40, BigInt(cdSize), true);
    zip64Eocd.setBigUint64(48, BigInt(cdStart), true);

    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, ZIP64_EOCD_LOCATOR_SIGNATURE, true);
    locator.setUint32(4, 0, true);
    locator.setBigUint64(8, BigInt(cdStart + cdSize), true);
    locator.setUint32(16, 1, true);

    parts.push(zip64Eocd.buffer, locator.buffer);
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, EOCD_SIGNATURE, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, Math.min(prepared.length, 0xffff), true);
  eocd.setUint16(10, Math.min(prepared.length, 0xffff), true);
  eocd.setUint32(12, Math.min(cdSize, NEEDS_ZIP64), true);
  eocd.setUint32(16, Math.min(cdStart, NEEDS_ZIP64), true);
  eocd.setUint16(20, 0, true);
  parts.push(eocd.buffer);

  return new Blob(parts, { type: "application/zip" });
}

export function buildZip64LocalExtra(uncompressedSize: number, compressedSize: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(20));
  view.setUint16(0, ZIP64_EXTRA_ID, true);
  view.setUint16(2, 16, true);
  view.setBigUint64(4, BigInt(uncompressedSize), true);
  view.setBigUint64(12, BigInt(compressedSize), true);
  return new Uint8Array(view.buffer);
}

export function buildZip64CentralExtra(uncompressedSize: number, compressedSize: number, localHeaderOffset: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(28));
  view.setUint16(0, ZIP64_EXTRA_ID, true);
  view.setUint16(2, 24, true);
  view.setBigUint64(4, BigInt(uncompressedSize), true);
  view.setBigUint64(12, BigInt(compressedSize), true);
  view.setBigUint64(20, BigInt(localHeaderOffset), true);
  return new Uint8Array(view.buffer);
}
