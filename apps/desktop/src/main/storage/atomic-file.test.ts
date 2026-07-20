import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic, writeFileAtomicSync } from './atomic-file';

describe('atomic file writes', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swaft-atomic-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a new file and replaces an existing one, leaving no temp files behind', async () => {
    const target = join(dir, 'nested', 'store.json');

    writeFileAtomicSync(target, 'first');
    expect(readFileSync(target, 'utf8')).toBe('first');

    await writeFileAtomic(target, 'second');
    expect(readFileSync(target, 'utf8')).toBe('second');

    expect(readdirSync(join(dir, 'nested'))).toEqual(['store.json']);
  });

  it('writes binary content unchanged', async () => {
    const target = join(dir, 'image.bin');
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    await writeFileAtomic(target, bytes);
    expect(new Uint8Array(readFileSync(target))).toEqual(bytes);
  });
});
