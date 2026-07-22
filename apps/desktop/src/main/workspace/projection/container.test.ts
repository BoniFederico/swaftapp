import { describe, expect, it } from 'vitest';
import { isZip } from '@swaft/shared';
import { InProcessDbBackend } from '../../storage/db-backend';
import type { SqlParam } from '../../storage/sqlite';
import { LocalAdapter } from '../LocalAdapter';
import { MemoryDirFs } from './dir-fs';
import { hydrateWorkspace } from './projection';
import { packContainer, unpackContainer } from './container';

let tick = 0;
const isoNow = () => new Date(1_700_000_000_000 + tick++).toISOString();

async function ins(a: LocalAdapter, table: string, domain: Record<string, SqlParam>): Promise<void> {
  const now = isoNow();
  const row = { ...domain, created_at: now, updated_at: now, updated_by_device_id: 'dev', revision: 1, deleted_at: null };
  const cols = Object.keys(row);
  await a.run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => (row as Record<string, SqlParam>)[c]),
  );
}

async function sample(): Promise<LocalAdapter> {
  const a = new LocalAdapter(await InProcessDbBackend.open());
  await a.initialize({ name: 'Portable', storageMode: 'local', executionMode: 'sandbox', deviceId: 'dev', now: isoNow() });
  await ins(a, 'projects', { id: 'p1', name: 'Billing', color: '#f80', description: null });
  await ins(a, 'templates', {
    id: 't1',
    folder_id: '',
    project_id: 'p1',
    name: 'Get user',
    type: 'api',
    subtype: 'GET',
    source: JSON.stringify({ method: 'GET', url: 'https://api.test/u/1', headers: { Accept: 'application/json' } }),
    has_draft: 1,
  });
  return a;
}

async function names(a: LocalAdapter): Promise<{ projects: string[]; templates: string[] }> {
  const projects = (await a.all<{ name: string }>('SELECT name FROM projects WHERE deleted_at IS NULL')).map((r) => r.name);
  const templates = (await a.all<{ name: string }>('SELECT name FROM templates WHERE deleted_at IS NULL')).map((r) => r.name);
  return { projects, templates };
}

describe('.swaft container (zip of the projection)', () => {
  it('packs to a real zip and round-trips through unpack → hydrate (identical workspace)', async () => {
    const a = await sample();
    const bytes = await packContainer(a);
    expect(isZip(bytes)).toBe(true);

    // Unpack into a fresh in-memory dir and hydrate a new adapter from it.
    const dir = new MemoryDirFs();
    await unpackContainer(bytes, dir);
    expect(dir.snapshot().has('workspace.json')).toBe(true);
    // The api template landed as an open-format request.http (not a JSON blob).
    expect([...dir.snapshot().keys()].some((p) => p.endsWith('/request.http'))).toBe(true);

    const b = new LocalAdapter(await InProcessDbBackend.open());
    await b.createSchema();
    await hydrateWorkspace(b, dir, { deviceId: 'dev-2', now: isoNow(), storageMode: 'local' });

    expect(await names(b)).toEqual(await names(a));
    expect((await b.getMeta())?.name).toBe('Portable');
    await a.close();
    await b.close();
  });

  it('rejects unpacking a non-container file', async () => {
    await expect(unpackContainer(new Uint8Array([1, 2, 3, 4]), new MemoryDirFs())).rejects.toMatchObject({
      code: 'INVALID_WORKSPACE',
    });
  });
});
