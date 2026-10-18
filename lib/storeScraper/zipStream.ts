import "server-only";
import {
  crc32,
  buildZip64LocalExtra,
  buildZip64CentralExtra,
  LOCAL_FILE_SIGNATURE,
  CENTRAL_DIR_SIGNATURE,
  ZIP64_EOCD_SIGNATURE,
  ZIP64_EOCD_LOCATOR_SIGNATURE,
  EOCD_SIGNATURE,
  UTF8_FLAG,
  NEEDS_ZIP64,
} from "@/lib/zipWriter";

/**
 * Pauses until the stream's own internal queue has room again (or
 * `shouldStop` says to give up waiting because the client disconnected).
 * Reading from local disk is almost always far faster than a client's
 * actual download speed, and `controller.enqueue()` never blocks by
 * itself — with nothing checking backpressure, a slow client (or one
 * that's paused the download) lets every file a zip export ever produces
 * pile up in the stream's internal queue in memory, which is exactly what
 * crashes the whole Node process with "Allocation failed - JavaScript
 * heap out of memory" on a real multi-thousand-file export. Every
 * disk-streamed zip route in this app shares this helper so the fix (and
 * the reasoning behind it) lives in one place.
 */
export async function waitForDrain(
  controller: ReadableStreamDefaultController<Uint8Array>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  while (!shouldStop() && controller.desiredSize !== null && controller.desiredSize <= 0) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface CentralRecord {
  nameBytes: Uint8Array;
  size: number;
  crc: number;
  offset: number;
}

/**
 * A STORED-only (no compression), incremental counterpart to
 * `zipWriter.ts`'s `createZipBlob` — same byte-level PKZIP format
 * (including the same Zip64 fallback for a huge archive), reusing its CRC
 * and Zip64-extra-field builders directly rather than duplicating them.
 *
 * The difference is what it's FOR: `createZipBlob` buffers every entry
 * and returns one finished `Blob` — correct for building a zip to hand off
 * as a single unit, but it means nothing reaches the caller until the
 * ENTIRE archive is done. This instead hands back each entry's bytes the
 * moment `addEntry` is called, so a caller streaming an HTTP response
 * (`export-media`'s route) can push bytes to the browser as they're ready
 * — the download starts immediately and grows as images finish, instead
 * of the browser sitting on a spinner until the whole zip finishes
 * building server-side. STORED-only is deliberate, matching
 * `mediaExport.ts`'s own reasoning: these are already-compressed image
 * bytes, so there's no deflate step to skip streaming for anyway.
 */
export class ZipStreamWriter {
  private offset = 0;
  private central: CentralRecord[] = [];
  private encoder = new TextEncoder();

  /** Returns the bytes to write immediately for this entry (local file header + name + data) — push these straight into the response stream. */
  addEntry(path: string, bytes: Uint8Array): Uint8Array {
    const nameBytes = this.encoder.encode(path);
    const crc = crc32(bytes);
    const size = bytes.length;
    const useZip64 = size >= NEEDS_ZIP64 || this.offset >= NEEDS_ZIP64;
    const extra = useZip64 ? buildZip64LocalExtra(size, size) : new Uint8Array(0);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, LOCAL_FILE_SIGNATURE, true);
    header.setUint16(4, useZip64 ? 45 : 20, true);
    header.setUint16(6, UTF8_FLAG, true);
    header.setUint16(8, 0, true); // stored — no compression
    header.setUint16(10, 0, true); // mod time
    header.setUint16(12, 0, true); // mod date
    header.setUint32(14, crc, true);
    header.setUint32(18, useZip64 ? NEEDS_ZIP64 : size, true);
    header.setUint32(22, useZip64 ? NEEDS_ZIP64 : size, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, extra.length, true);

    const out = new Uint8Array(30 + nameBytes.length + extra.length + size);
    out.set(new Uint8Array(header.buffer), 0);
    out.set(nameBytes, 30);
    out.set(extra, 30 + nameBytes.length);
    out.set(bytes, 30 + nameBytes.length + extra.length);

    this.central.push({ nameBytes, size, crc, offset: this.offset });
    this.offset += out.length;
    return out;
  }

  /** Returns the trailing bytes (central directory + end-of-central-directory record) — call exactly once, after every entry has been added, and push the result as the final chunk before closing the stream. */
  finish(): Uint8Array {
    const parts: Uint8Array[] = [];
    const cdStart = this.offset;

    for (const entry of this.central) {
      const useZip64 = entry.size >= NEEDS_ZIP64 || entry.offset >= NEEDS_ZIP64;
      const extra = useZip64 ? buildZip64CentralExtra(entry.size, entry.size, entry.offset) : new Uint8Array(0);

      const header = new DataView(new ArrayBuffer(46));
      header.setUint32(0, CENTRAL_DIR_SIGNATURE, true);
      header.setUint16(4, useZip64 ? 45 : 20, true);
      header.setUint16(6, useZip64 ? 45 : 20, true);
      header.setUint16(8, UTF8_FLAG, true);
      header.setUint16(10, 0, true); // stored
      header.setUint16(12, 0, true);
      header.setUint16(14, 0, true);
      header.setUint32(16, entry.crc, true);
      header.setUint32(20, useZip64 ? NEEDS_ZIP64 : entry.size, true);
      header.setUint32(24, useZip64 ? NEEDS_ZIP64 : entry.size, true);
      header.setUint16(28, entry.nameBytes.length, true);
      header.setUint16(30, extra.length, true);
      header.setUint16(32, 0, true);
      header.setUint16(34, 0, true);
      header.setUint16(36, 0, true);
      header.setUint32(38, 0, true);
      header.setUint32(42, useZip64 ? NEEDS_ZIP64 : entry.offset, true);

      const bytes = new Uint8Array(46 + entry.nameBytes.length + extra.length);
      bytes.set(new Uint8Array(header.buffer), 0);
      bytes.set(entry.nameBytes, 46);
      bytes.set(extra, 46 + entry.nameBytes.length);
      parts.push(bytes);
      this.offset += bytes.length;
    }

    const cdSize = this.offset - cdStart;
    const needsZip64Eocd = this.central.length >= 0xffff || cdSize >= NEEDS_ZIP64 || cdStart >= NEEDS_ZIP64;

    if (needsZip64Eocd) {
      const zip64Eocd = new DataView(new ArrayBuffer(56));
      zip64Eocd.setUint32(0, ZIP64_EOCD_SIGNATURE, true);
      zip64Eocd.setBigUint64(4, BigInt(44), true);
      zip64Eocd.setUint16(12, 45, true);
      zip64Eocd.setUint16(14, 45, true);
      zip64Eocd.setUint32(16, 0, true);
      zip64Eocd.setUint32(20, 0, true);
      zip64Eocd.setBigUint64(24, BigInt(this.central.length), true);
      zip64Eocd.setBigUint64(32, BigInt(this.central.length), true);
      zip64Eocd.setBigUint64(40, BigInt(cdSize), true);
      zip64Eocd.setBigUint64(48, BigInt(cdStart), true);

      const locator = new DataView(new ArrayBuffer(20));
      locator.setUint32(0, ZIP64_EOCD_LOCATOR_SIGNATURE, true);
      locator.setUint32(4, 0, true);
      locator.setBigUint64(8, BigInt(cdStart + cdSize), true);
      locator.setUint32(16, 1, true);

      parts.push(new Uint8Array(zip64Eocd.buffer), new Uint8Array(locator.buffer));
    }

    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, EOCD_SIGNATURE, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, Math.min(this.central.length, 0xffff), true);
    eocd.setUint16(10, Math.min(this.central.length, 0xffff), true);
    eocd.setUint32(12, Math.min(cdSize, NEEDS_ZIP64), true);
    eocd.setUint32(16, Math.min(cdStart, NEEDS_ZIP64), true);
    eocd.setUint16(20, 0, true);
    parts.push(new Uint8Array(eocd.buffer));

    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
      out.set(part, pos);
      pos += part.length;
    }
    return out;
  }
}
