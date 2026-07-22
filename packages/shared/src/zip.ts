/**
 * A tiny, dependency-free ZIP reader/writer — enough to make a `.swaft` file a **zip of the open
 * workspace folder** (open-standards plan D1), readable by any standard unzip tool.
 *
 * Scope, deliberately minimal:
 *  - **Write** uses the *store* method (no compression). Workspace files are small text; store keeps
 *    the writer trivially correct and the output deterministic (fixed 1980-01-01 timestamps), which
 *    matters for reproducible archives. No Node `zlib` dependency, so this stays browser-safe and
 *    lives in `@swaft/shared`.
 *  - **Read** parses the central directory and supports the *store* method (what we write). A
 *    deflate-compressed entry throws a clear error rather than silently corrupting.
 *
 * Everything is `Uint8Array`/`DataView`/`TextEncoder` based — no platform APIs.
 */

export interface ZipEntry {
  /** POSIX path inside the archive (forward slashes). */
  path: string;
  data: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION = 20; // 2.0 — the minimum for the store method
const UTF8_FLAG = 0x0800; // bit 11: filenames are UTF-8
const STORE = 0;
const DEFLATE = 8;
// A fixed, valid DOS date/time (1980-01-01 00:00:00) so archives are byte-reproducible.
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

// --- CRC-32 (IEEE 802.3) ----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!)! & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- Write ------------------------------------------------------------------

/** Serialize entries into a store-method ZIP archive. Entry order is preserved. */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = utf8.encode(entry.path);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, STORE, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size (== uncompressed for store)
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, VERSION, true); // version made by
    cv.setUint16(6, VERSION, true); // version needed
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, STORE, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // disk with cd start
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // cd offset = total local size
  ev.setUint16(20, 0, true); // comment length

  return concat([...locals, ...centrals, eocd]);
}

/** Convenience: build an archive from UTF-8 text entries. */
export function zipText(entries: readonly { path: string; text: string }[]): Uint8Array {
  return zip(entries.map((e) => ({ path: e.path, data: utf8.encode(e.text) })));
}

// --- Read -------------------------------------------------------------------

/** Parse a store-method ZIP archive into its entries. Throws on a malformed or compressed archive. */
export function unzip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // central directory offset

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== CENTRAL_SIG) {
      throw new Error('Invalid ZIP: bad central directory signature.');
    }
    const method = view.getUint16(ptr + 10, true);
    const size = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const path = utf8Decode.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    if (method !== STORE) {
      throw new Error(
        method === DEFLATE
          ? `Unsupported ZIP entry "${path}": deflate compression is not supported.`
          : `Unsupported ZIP entry "${path}": compression method ${method}.`,
      );
    }

    // Locate the data via the local header (its name/extra lengths can differ from the central one).
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new Error(`Invalid ZIP: bad local header for "${path}".`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + size);

    const expected = view.getUint32(ptr + 16, true);
    if (crc32(data) !== expected) throw new Error(`Corrupt ZIP: CRC mismatch for "${path}".`);

    entries.push({ path, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Convenience: read an archive as UTF-8 text entries. */
export function unzipText(bytes: Uint8Array): { path: string; text: string }[] {
  return unzip(bytes).map((e) => ({ path: e.path, text: utf8Decode.decode(e.data) }));
}

/** Whether a byte buffer begins with the ZIP local-file magic (`PK\x03\x04`). */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

// --- helpers ----------------------------------------------------------------

function findEocd(bytes: Uint8Array, view: DataView): number {
  // The EOCD is 22 bytes with a (here always empty) trailing comment, so scan back from the end.
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error('Invalid ZIP: end-of-central-directory record not found.');
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
