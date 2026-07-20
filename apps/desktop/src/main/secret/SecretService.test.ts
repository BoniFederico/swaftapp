import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityCipher } from '../auth/testing';
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

  it('treats a corrupt store file as empty instead of failing to construct', () => {
    writeFileSync(file, '{not json', 'utf8');
    const svc = new SecretService(file, new IdentityCipher());
    expect(svc.list()).toEqual([]);
    svc.set('k', 'v'); // and it can still write
    expect(new SecretService(file, new IdentityCipher()).get('k')).toBe('v');
  });
});
