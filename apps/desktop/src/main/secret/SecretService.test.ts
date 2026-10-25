import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityCipher } from './testing';
import { SecretService } from './SecretService';

describe('SecretService', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'swaft-secrets-'));
    file = join(dir, 'secrets.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores values through the cipher and persists across instances', () => {
    const svc = new SecretService(file, new IdentityCipher());
    svc.set('api-key', 'top-secret');

    // On-disk representation is the cipher's protected token (the test cipher is transparent on
    // purpose; production wraps with OS safeStorage).
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { secrets: Record<string, string> };
    expect(stored.secrets['api-key']).toBe('enc(top-secret)');

    // A fresh instance (new process) reads it back through the cipher.
    const again = new SecretService(file, new IdentityCipher());
    expect(again.get('api-key')).toBe('top-secret');
  });

  it('lists refs sorted (values never leave the main process) and deletes them', () => {
    const svc = new SecretService(file, new IdentityCipher());
    svc.set('zeta', '1');
    svc.set('alpha', '2');
    expect(svc.list()).toEqual(['alpha', 'zeta']);

    svc.delete('zeta');
    expect(svc.list()).toEqual(['alpha']);
    expect(svc.get('zeta')).toBeNull();
  });

  it('sets a corrupt store file aside (never overwrites it) and starts empty', () => {
    writeFileSync(file, '{not json', 'utf8');
    const svc = new SecretService(file, new IdentityCipher(), () => new Date(1234));
    expect(svc.list()).toEqual([]);
    expect(readFileSync(`${file}.corrupt-1234`, 'utf8')).toBe('{not json');
    svc.set('k', 'v'); // and it can still write
    expect(new SecretService(file, new IdentityCipher()).get('k')).toBe('v');
  });

  it('reports an undecryptable secret with a coded error', () => {
    const svc = new SecretService(file, new IdentityCipher());
    svc.set('k', 'v');
    const broken = new SecretService(file, {
      isAvailable: () => true,
      protect: (s) => s,
      reveal: () => {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      },
    });
    expect(() => broken.get('k')).toThrow(expect.objectContaining({ code: 'SECRET_UNREADABLE' }));
  });

  it('derives the storage level from the cipher', () => {
    expect(new SecretService(file, new IdentityCipher()).storageLevel()).toBe('secure');
    const weak = { isAvailable: () => true, level: () => 'weak' as const, protect: (s: string) => s, reveal: (s: string) => s };
    expect(new SecretService(file, weak).storageLevel()).toBe('weak');
  });
});
