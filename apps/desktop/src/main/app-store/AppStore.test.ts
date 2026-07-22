import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceSummary } from '@swaft/shared';
import { AppStore } from './AppStore';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swaft-appstore-'));
  file = join(dir, 'app-store.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function summary(path: string, name: string): WorkspaceSummary {
  return { path, name, icon: null, storageMode: 'local', executionMode: 'sandbox', encrypted: false };
}

describe('AppStore', () => {
  it('creates and persists a stable device id', () => {
    const first = new AppStore(file).getDeviceId();
    expect(first).toMatch(/[0-9a-f-]{36}/);
    // A new instance over the same file keeps the id.
    expect(new AppStore(file).getDeviceId()).toBe(first);
  });

  it('merges and persists preferences across reloads', () => {
    const a = new AppStore(file);
    a.setPreferences({ themeMode: 'dark', language: 'it' });
    a.setPreferences({ primaryColor: 'teal' });
    expect(new AppStore(file).getPreferences()).toEqual({
      themeMode: 'dark',
      language: 'it',
      primaryColor: 'teal',
    });
  });

  it('records recent workspaces most-recent-first, de-duplicated by path', () => {
    let clock = 1_000;
    const store = new AppStore(file, () => new Date(clock));

    clock = 1_000;
    store.recordRecent(summary('mem://a.swaft', 'A'));
    clock = 2_000;
    store.recordRecent(summary('mem://b.swaft', 'B'));
    clock = 3_000;
    store.recordRecent(summary('mem://a.swaft', 'A renamed')); // re-open A

    const recent = store.getRecent();
    expect(recent.map((r) => r.path)).toEqual(['mem://a.swaft', 'mem://b.swaft']);
    expect(recent[0]?.name).toBe('A renamed');
    expect(recent[0]?.lastOpenedAt).toBe(new Date(3_000).toISOString());
  });

  it('removes a recent entry (and persists), leaving the rest and the file untouched', () => {
    const store = new AppStore(file);
    store.recordRecent(summary('mem://a.swaft', 'A'));
    store.recordRecent(summary('mem://b.swaft', 'B'));

    store.removeRecent('mem://a.swaft');
    expect(store.getRecent().map((r) => r.path)).toEqual(['mem://b.swaft']);
    // Removing an unknown path is a no-op.
    store.removeRecent('mem://missing.swaft');
    expect(store.getRecent().map((r) => r.path)).toEqual(['mem://b.swaft']);
    // The removal is durable across reloads.
    expect(new AppStore(file).getRecent().map((r) => r.path)).toEqual(['mem://b.swaft']);
  });
});
