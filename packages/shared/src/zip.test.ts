import { describe, it, expect } from 'vitest';
import { zip, unzip, zipText, unzipText, crc32, isZip } from './zip';

const enc = new TextEncoder();

describe('zip codec', () => {
  it('round-trips multiple nested text entries, preserving order and content', () => {
    const files = [
      { path: 'workspace.json', text: '{\n  "name": "WS"\n}\n' },
      { path: 'templates/get-user.a1b2/request.http', text: 'GET https://x/\nAccept: */*\n' },
      { path: 'environments/staging.e1.json', text: '{}\n' },
    ];
    const bytes = zipText(files);
    expect(isZip(bytes)).toBe(true);
    expect(unzipText(bytes)).toEqual(files);
  });

  it('produces a valid EOCD with the right entry count and forward-slash paths', () => {
    const bytes = zipText([
      { path: 'a.txt', text: 'A' },
      { path: 'dir/b.txt', text: 'B' },
    ]);
    const view = new DataView(bytes.buffer);
    // EOCD is the trailing 22 bytes (no comment); signature + total-records field.
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    expect(unzip(bytes).map((e) => e.path)).toEqual(['a.txt', 'dir/b.txt']);
  });

  it('handles binary data and an empty file', () => {
    const bin = new Uint8Array([0, 1, 2, 255, 254, 0, 128]);
    const bytes = zip([
      { path: 'empty', data: new Uint8Array(0) },
      { path: 'blob.bin', data: bin },
    ]);
    const out = unzip(bytes);
    expect(out[0]).toEqual({ path: 'empty', data: new Uint8Array(0) });
    expect(Array.from(out[1]!.data)).toEqual(Array.from(bin));
  });

  it('is deterministic — same input yields byte-identical output', () => {
    const mk = () => zipText([{ path: 'x', text: 'hello' }]);
    expect(Array.from(mk())).toEqual(Array.from(mk()));
  });

  it('detects corruption via the stored CRC-32', () => {
    const bytes = zipText([{ path: 'x.txt', text: 'hello world' }]);
    // Flip a byte inside the file data region (just past the 30-byte local header + 5-byte name).
    const tampered = bytes.slice();
    tampered[30 + 'x.txt'.length + 2]! ^= 0xff;
    expect(() => unzip(tampered)).toThrow(/CRC mismatch/);
  });

  it('computes a known CRC-32 vector', () => {
    // CRC-32 of "123456789" is the standard check value 0xCBF43926.
    expect(crc32(enc.encode('123456789')) >>> 0).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('rejects a non-zip buffer', () => {
    expect(isZip(new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(() => unzip(new Uint8Array([1, 2, 3, 4]))).toThrow(/end-of-central-directory/);
  });
});
