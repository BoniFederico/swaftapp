import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAccountStore } from './stores';
import type { AccountRecord } from './types';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swaft-accounts-'));
  file = join(dir, 'account.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function record(username: string): AccountRecord {
  return {
    username,
    displayName: username,
    protectedVerifier: `enc(${username})`,
    createdAt: new Date().toISOString(),
    failedAttempts: 0,
    lockedUntil: null,
  };
}

describe('FileAccountStore', () => {
  it('round-trips accounts in the multi-account format', () => {
    const store = new FileAccountStore(file);
    store.upsert(record('alice'));
    store.upsert(record('bob'));
    expect(new FileAccountStore(file).list().map((a) => a.username).sort()).toEqual(['alice', 'bob']);
  });

  it('recovers a legacy single-account file (pre multi-account)', () => {
    // The old format stored one AccountRecord at the top level (no `accounts` array).
    writeFileSync(file, JSON.stringify(record('legacy')), 'utf8');

    const store = new FileAccountStore(file);
    expect(store.list().map((a) => a.username)).toEqual(['legacy']);
    expect(store.get('legacy')?.username).toBe('legacy');

    // A subsequent write migrates the file to the new format.
    store.upsert(record('new'));
    expect(new FileAccountStore(file).list().map((a) => a.username).sort()).toEqual([
      'legacy',
      'new',
    ]);
  });
});
