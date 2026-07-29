import { describe, expect, it } from 'vitest';
import { InProcessDbBackend } from '../../storage/db-backend';
import type { SqlParam } from '../../storage/sqlite';
import type { LocalAdapter } from '../LocalAdapter';
import { MemoryDirFs } from '../projection/dir-fs';
import { FolderPersistence } from './FolderPersistence';

async function insProject(a: LocalAdapter, id: string, name: string): Promise<void> {
  const now = '2024-01-01T00:00:00.000Z';
  const row: Record<string, SqlParam> = {
    id,
    name,
    color: null,
    description: null,
    created_at: now,
    updated_at: now,
    updated_by_device_id: 'dev',
    revision: 1,
    deleted_at: null,
  };
  const cols = Object.keys(row);
  await a.run(
    `INSERT INTO projects (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c]),
  );
}

describe('FolderPersistence (in-memory)', () => {
  function make() {
    const fs = new MemoryDirFs();
    const persistence = new FolderPersistence({
      createBackend: (bytes) => InProcessDbBackend.open(bytes),
      deviceId: () => 'dev-1',
      now: () => '2024-01-01T00:00:00.000Z',
      dirFs: () => fs,
    });
    return { fs, persistence };
  }

  const base = {
    executionMode: 'sandbox' as const,
    deviceId: 'dev-1',
    now: '2024-01-01T00:00:00.000Z',
  };

  it('creates a folder workspace: scaffolds and dumps readable files, never encrypted', async () => {
    const { fs, persistence } = make();
    const opened = await persistence.create({ name: 'Folder WS', location: '/ws', ...base });

    expect(opened.encrypted).toBe(false);
    const files = fs.snapshot();
    expect(files.has('workspace.json')).toBe(true);
    expect(files.has('.gitignore')).toBe(true);
    expect(files.has('.gitattributes')).toBe(true);
    // Stamped as a local workspace (not git).
    expect((await opened.adapter.getMeta())?.storage_mode).toBe('local');
    await opened.adapter.close();
  });

  it('round-trips content through save → open', async () => {
    const { persistence } = make();
    const created = await persistence.create({ name: 'Folder WS', location: '/ws', ...base });
    await insProject(created.adapter, 'p1', 'Billing');
    await persistence.save(created.adapter, '/ws');
    await created.adapter.close();

    const reopened = await persistence.open({ location: '/ws' });
    const meta = await reopened.adapter.getMeta();
    expect(meta?.name).toBe('Folder WS');
    expect(meta?.storage_mode).toBe('local');
    const projects = await reopened.adapter.all('SELECT name FROM projects WHERE deleted_at IS NULL');
    expect(projects).toEqual([{ name: 'Billing' }]);
    await reopened.adapter.close();
  });

  it('rejects opening a directory that is not a Swaft workspace', async () => {
    const { persistence } = make();
    await expect(persistence.open({ location: '/empty' })).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
    });
  });

  it('carries 🔵 local-only tables across save → open via the git-ignored /.swaft/ cache (§3.5)', async () => {
    const { fs, persistence } = make();
    const created = await persistence.create({ name: 'Folder WS', location: '/ws', ...base });
    await created.adapter.run(
      `INSERT INTO api_history (id, template_id, method, url, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['h1', 'tpl-1', 'GET', 'https://example.test', 200, '2024-01-01T00:00:00.000Z'],
    );
    await persistence.save(created.adapter, '/ws');
    await created.adapter.close();

    // Lives under the reserved, git-ignored cache path — never inside the versioned projection tree.
    expect(fs.snapshot().has('.swaft/local-cache.json')).toBe(true);

    const reopened = await persistence.open({ location: '/ws' });
    const history = await reopened.adapter.all('SELECT template_id, method, url, status FROM api_history');
    expect(history).toEqual([{ template_id: 'tpl-1', method: 'GET', url: 'https://example.test', status: 200 }]);
    await reopened.adapter.close();
  });

  it('opens cleanly when the /.swaft/ cache file is absent (older workspace, never saved since §3.5)', async () => {
    const { fs, persistence } = make();
    const created = await persistence.create({ name: 'Folder WS', location: '/ws', ...base });
    await created.adapter.close();
    expect(fs.snapshot().has('.swaft/local-cache.json')).toBe(false);

    const reopened = await persistence.open({ location: '/ws' });
    await expect(reopened.adapter.all('SELECT * FROM api_history')).resolves.toEqual([]);
    await reopened.adapter.close();
  });
});
