import { describe, expect, it } from 'vitest';
import { InProcessDbBackend } from '../../storage/db-backend';
import { LocalAdapter } from '../LocalAdapter';
import { MemoryDirFs } from './dir-fs';
import { dumpLocalCache, hydrateLocalCache } from './local-cache';

async function makeAdapter(): Promise<LocalAdapter> {
  const adapter = new LocalAdapter(await InProcessDbBackend.open());
  await adapter.createSchema();
  return adapter;
}

describe('local-cache (open-standards §3.5)', () => {
  it('round-trips rows across several 🔵 local-only tables', async () => {
    const fs = new MemoryDirFs();
    const a = await makeAdapter();
    await a.run(
      'INSERT INTO api_history (id, template_id, method, url, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['h1', 'tpl-1', 'GET', 'https://example.test', 200, '2024-01-01T00:00:00.000Z'],
    );
    await a.run(
      'INSERT INTO local_input_state (template_id, values_json, updated_at) VALUES (?, ?, ?)',
      ['tpl-1', '{"a":1}', '2024-01-01T00:00:00.000Z'],
    );
    await dumpLocalCache(a, fs);
    await a.close();

    const b = await makeAdapter();
    await hydrateLocalCache(b, fs);
    expect(await b.all('SELECT template_id, method, url, status FROM api_history')).toEqual([
      { template_id: 'tpl-1', method: 'GET', url: 'https://example.test', status: 200 },
    ]);
    expect(await b.all('SELECT template_id, values_json FROM local_input_state')).toEqual([
      { template_id: 'tpl-1', values_json: '{"a":1}' },
    ]);
    await b.close();
  });

  it('is a no-op when no cache file exists', async () => {
    const fs = new MemoryDirFs();
    const a = await makeAdapter();
    await expect(hydrateLocalCache(a, fs)).resolves.toBeUndefined();
    expect(await a.all('SELECT * FROM api_history')).toEqual([]);
    await a.close();
  });

  it('tolerates a corrupt cache file instead of failing to open', async () => {
    const fs = new MemoryDirFs();
    await fs.writeFile('.swaft/local-cache.json', 'not json{');
    const a = await makeAdapter();
    await expect(hydrateLocalCache(a, fs)).resolves.toBeUndefined();
    expect(await a.all('SELECT * FROM api_history')).toEqual([]);
    await a.close();
  });

  it('writes an empty-but-valid cache for a workspace with no local-only rows yet', async () => {
    const fs = new MemoryDirFs();
    const a = await makeAdapter();
    await dumpLocalCache(a, fs);
    const raw = fs.snapshot().get('.swaft/local-cache.json');
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!).api_history).toEqual([]);
    await a.close();
  });
});
