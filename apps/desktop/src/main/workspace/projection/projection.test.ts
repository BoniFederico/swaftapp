import { describe, it, expect } from 'vitest';
import { AppError } from '../../errors';
import type { SqlParam } from '../../storage/sqlite';
import { InProcessDbBackend } from '../../storage/db-backend';
import { LocalAdapter } from '../LocalAdapter';
import { canonicalJson } from './canonical-json';
import { MemoryDirFs } from './dir-fs';
import { fromHttpFile, toHttpFile } from '@swaft/shared';
import { dumpWorkspace, hydrateWorkspace, sourceExtension } from './projection';
import { entityBaseName, shortId } from './naming';

/** Hybrid on-disk names (D2) for the fixture entities, so path assertions track the real scheme. */
const N = {
  projBilling: `projects/${entityBaseName('Billing', 'proj-1')}.json`,
  projInfra: `projects/${entityBaseName('Infra', 'proj-2')}.json`,
  tplDoc: `templates/${entityBaseName('Release notes', 'tpl-doc')}`,
  tplCap: `templates/${entityBaseName('slugify', 'tpl-cap')}`,
  tplApi: `templates/${entityBaseName('Get user', 'tpl-api')}`,
  tagDead: `tags/${entityBaseName('gone', 'tag-dead')}.json`,
  relV1: `v1.${shortId('rel-1')}.json`,
};

/**
 * Mirror the projection's api round-trip (source → request.http + api-meta → source) so the snapshot
 * compares api requests at the **domain** level, not by exact JSON bytes: the `.http` form normalizes
 * (materializes Content-Type from bodyType, drops empty headers), which is equivalent but not
 * byte-identical.
 */
function canonicalApiSource(source: string): string {
  let model: Record<string, unknown>;
  try {
    model = JSON.parse(source) as Record<string, unknown>;
  } catch {
    model = { method: 'GET', url: '' };
  }
  const out: Record<string, unknown> = { ...fromHttpFile(toHttpFile(model as never)) };
  if (model.auth) out.auth = model.auth;
  if (Array.isArray(model.actions) && model.actions.length > 0) out.actions = model.actions;
  return JSON.stringify(out);
}

/** A monotonic clock so inserted rows get distinct, deterministic timestamps. */
let tick = 0;
function isoNow(): string {
  return new Date(1_700_000_000_000 + tick++).toISOString();
}

async function freshAdapter(): Promise<LocalAdapter> {
  return new LocalAdapter(await InProcessDbBackend.open());
}

/** Insert a domain row plus regenerated sync metadata (mirrors RepoBase). */
async function ins(a: LocalAdapter, table: string, domain: Record<string, SqlParam>): Promise<void> {
  const now = isoNow();
  const row: Record<string, SqlParam> = {
    ...domain,
    created_at: now,
    updated_at: now,
    updated_by_device_id: 'dev-A',
    revision: 1,
    deleted_at: null,
  };
  const cols = Object.keys(row);
  await a.run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c]),
  );
}

async function softDelete(a: LocalAdapter, table: string, id: string): Promise<void> {
  await a.run(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, ['2024-01-01T00:00:00.000Z', id]);
}

/**
 * Build a workspace exercising every 🟢 synchronized table, JSON-config columns (incl. nulls),
 * source of several template types, tags, releases, and soft-deleted rows.
 */
async function buildSampleWorkspace(): Promise<LocalAdapter> {
  const a = await freshAdapter();
  await a.initialize({
    name: 'Acme Ops',
    storageMode: 'git',
    executionMode: 'sandbox',
    deviceId: 'dev-A',
    now: isoNow(),
  });
  await a.updateMeta({ icon: '🚀' }, 'dev-A', isoNow());

  await ins(a, 'workspace_settings', {
    id: 'settings',
    execution_mode: 'sandbox',
    blocked_domains: JSON.stringify(['evil.test', 'blocked.example']),
    proxy_url: null,
    enforced_headers: JSON.stringify({ 'X-Team': 'ops' }),
    batcher_enabled: 1,
  });

  await ins(a, 'projects', { id: 'proj-1', name: 'Billing', color: '#f80', description: 'Money' });
  await ins(a, 'projects', { id: 'proj-2', name: 'Infra', color: null, description: null });

  await ins(a, 'folders', {
    id: 'fold-1',
    name: 'HTTP calls',
    project_id: 'proj-1',
    parent_folder_id: null,
    headers: JSON.stringify({ 'X-Api-Version': '2' }),
    proxy: JSON.stringify({ url: 'http://proxy.test:8080' }),
    auth: null,
    actions: JSON.stringify([{ ref: 'pre', trigger: 'before' }]),
    notes: '# Notes\nSome **markdown**.',
  });
  await ins(a, 'folders', {
    id: 'fold-2',
    name: 'Nested',
    project_id: 'proj-1',
    parent_folder_id: 'fold-1',
    headers: '{}',
    proxy: null,
    auth: null,
    actions: '[]',
    notes: '',
  });

  await ins(a, 'tags', { id: 'tag-a', name: 'ops', color: '#0a0' });
  await ins(a, 'tags', { id: 'tag-b', name: 'public', color: null });
  await ins(a, 'tags', { id: 'tag-dead', name: 'gone', color: null });
  await softDelete(a, 'tags', 'tag-dead');

  await ins(a, 'environments', {
    id: 'env-1',
    name: 'staging',
    description: 'Staging env',
    owner_kind: 'workspace',
    owner_id: null,
    vars: JSON.stringify({ baseUrl: 'https://staging.acme.test', tenant: 'acme' }),
  });
  await ins(a, 'environments', {
    id: 'env-2',
    name: 'mine',
    description: null,
    owner_kind: 'user',
    owner_id: 'alice',
    vars: '{}',
  });

  // document (markdown) with two tags + a release
  await ins(a, 'templates', {
    id: 'tpl-doc',
    folder_id: '',
    project_id: 'proj-1',
    name: 'Release notes',
    type: 'document',
    subtype: 'markdown',
    source: '# Release {{version}}\n\n- item one\n- item two\n',
    has_draft: 1,
  });
  await ins(a, 'template_tags', { id: 'tt-1', template_id: 'tpl-doc', tag_id: 'tag-a' });
  await ins(a, 'template_tags', { id: 'tt-2', template_id: 'tpl-doc', tag_id: 'tag-b' });
  await ins(a, 'releases', {
    id: 'rel-1',
    template_id: 'tpl-doc',
    version: 1,
    name: 'v1.0.0',
    subtype: 'markdown',
    source: '# Release v1\n',
  });

  // api (json request source), foldered, no tags
  await ins(a, 'templates', {
    id: 'tpl-api',
    folder_id: 'fold-1',
    project_id: null,
    name: 'Get user',
    type: 'api',
    subtype: 'GET',
    source: JSON.stringify({
      method: 'POST',
      url: 'https://api.test/u/1',
      headers: { Accept: 'application/json' },
      body: '{"a":1}',
      bodyType: 'json',
      auth: { kind: 'bearer', token: "${ secret('T') }" },
      actions: [{ ref: 'log', trigger: 'pre' }],
    }),
    has_draft: 1,
  });

  // capability (js), plus a soft-deleted template that must vanish from the files
  await ins(a, 'templates', {
    id: 'tpl-cap',
    folder_id: '',
    project_id: 'proj-2',
    name: 'slugify',
    type: 'capability',
    subtype: null,
    source: 'export default (s) => s.toLowerCase();\n',
    has_draft: 0,
  });
  await ins(a, 'templates', {
    id: 'tpl-dead',
    folder_id: '',
    project_id: 'proj-2',
    name: 'obsolete',
    type: 'document',
    subtype: 'txt',
    source: 'gone',
    has_draft: 1,
  });
  await softDelete(a, 'templates', 'tpl-dead');

  await ins(a, 'changelog', {
    id: 'log-1',
    entity_type: 'template',
    entity_id: 'tpl-doc',
    message: 'Created Release notes',
    username: 'alice',
  });

  return a;
}

// --- Semantic snapshot (independent oracle) --------------------------------

type Domain = Record<string, unknown>;

function pick(row: Record<string, SqlParam>, cols: string[], json: string[] = [], bool: string[] = []): Domain {
  const out: Domain = {};
  for (const c of cols) {
    const raw = row[c];
    if (json.includes(c)) out[c] = raw == null ? null : JSON.parse(String(raw));
    else if (bool.includes(c)) out[c] = Number(raw) !== 0;
    else out[c] = raw ?? null;
  }
  return out;
}

async function rows(a: LocalAdapter, table: string): Promise<Record<string, SqlParam>[]> {
  return a.all<Record<string, SqlParam>>(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY id`);
}

/** A storage-mode- and device-independent view of the workspace's domain content. */
async function snapshot(a: LocalAdapter): Promise<Domain> {
  const meta = await a.getMeta();
  const settingsRow = await a.get<Record<string, SqlParam>>(
    'SELECT * FROM workspace_settings WHERE deleted_at IS NULL',
  );
  const templates: Domain[] = [];
  for (const t of await rows(a, 'templates')) {
    const tagRows = await a.all<{ tag_id: string }>(
      'SELECT tag_id FROM template_tags WHERE template_id = ? AND deleted_at IS NULL ORDER BY tag_id',
      [String(t.id)],
    );
    const releaseRows = await a.all<Record<string, SqlParam>>(
      'SELECT * FROM releases WHERE template_id = ? AND deleted_at IS NULL ORDER BY id',
      [String(t.id)],
    );
    const picked = pick(
      t,
      ['id', 'folder_id', 'project_id', 'name', 'type', 'subtype', 'source'],
      [],
      ['has_draft'],
    );
    if (picked.type === 'api') picked.source = canonicalApiSource(String(picked.source));
    templates.push({
      ...picked,
      tags: tagRows.map((r) => r.tag_id),
      releases: releaseRows.map((r) =>
        pick(r, ['id', 'template_id', 'version', 'name', 'subtype', 'source']),
      ),
    });
  }
  return {
    // storage_mode + device_id are intentionally excluded (not versioned).
    workspace: { name: meta?.name, icon: meta?.icon, executionMode: meta?.execution_mode },
    settings: settingsRow
      ? pick(
          settingsRow,
          ['id', 'execution_mode', 'proxy_url', 'blocked_domains', 'enforced_headers'],
          ['blocked_domains', 'enforced_headers'],
          [],
        )
      : null,
    settingsBatcher: settingsRow ? Number(settingsRow.batcher_enabled) !== 0 : null,
    projects: (await rows(a, 'projects')).map((r) => pick(r, ['id', 'name', 'color', 'description'])),
    folders: (await rows(a, 'folders')).map((r) =>
      pick(
        r,
        ['id', 'name', 'project_id', 'parent_folder_id', 'headers', 'proxy', 'auth', 'actions', 'notes'],
        ['headers', 'proxy', 'auth', 'actions'],
      ),
    ),
    tags: (await rows(a, 'tags')).map((r) => pick(r, ['id', 'name', 'color'])),
    environments: (await rows(a, 'environments')).map((r) =>
      pick(r, ['id', 'name', 'description', 'owner_kind', 'owner_id', 'vars'], ['vars']),
    ),
    changelog: (await rows(a, 'changelog')).map((r) =>
      pick(r, ['id', 'entity_type', 'entity_id', 'message', 'username']),
    ),
  };
}

// --- Tests ------------------------------------------------------------------

describe('WorkspaceProjection', () => {
  it('round-trips every synchronized entity through the file layout (dump → hydrate)', async () => {
    const a = await buildSampleWorkspace();
    const fs = new MemoryDirFs();
    await dumpWorkspace(a, fs);

    const b = await freshAdapter();
    await b.createSchema();
    await hydrateWorkspace(b, fs, { deviceId: 'dev-B', now: isoNow(), storageMode: 'git' });

    expect(await snapshot(b)).toEqual(await snapshot(a));
  });

  it('hydrates a v1 api template written as source.json by an older Swaft (back-compat)', async () => {
    const fs = new MemoryDirFs();
    await fs.writeFile(
      'workspace.json',
      JSON.stringify({ formatVersion: 1, schemaVersion: 2, name: 'Old', executionMode: 'sandbox' }),
    );
    await fs.writeFile(
      'projects/p.json',
      JSON.stringify({ id: 'p', name: 'P', color: null, description: null }),
    );
    await fs.writeFile(
      'templates/old-api/template.json',
      JSON.stringify({ id: 'old-api', folderId: '', projectId: 'p', name: 'Legacy', type: 'api', subtype: 'json', hasDraft: true, tags: [] }),
    );
    await fs.writeFile(
      'templates/old-api/source.json',
      JSON.stringify({ method: 'GET', url: 'https://legacy/x' }),
    );

    const b = await freshAdapter();
    await b.createSchema();
    await hydrateWorkspace(b, fs, { deviceId: 'd', now: isoNow(), storageMode: 'git' });

    const row = await b.get<{ source: string }>("SELECT source FROM templates WHERE id = 'old-api'");
    expect(JSON.parse(row!.source)).toEqual({ method: 'GET', url: 'https://legacy/x' });
  });

  it('lays out readable files: manifest, source sidecars, embedded tags, nested releases', async () => {
    const a = await buildSampleWorkspace();
    const fs = new MemoryDirFs();
    await dumpWorkspace(a, fs);
    const files = fs.snapshot();
    const paths = [...files.keys()].sort();

    expect(paths).toContain('workspace.json');
    expect(paths).toContain('settings.json');
    // Hybrid naming (D2): `<slug>.<shortId>` — browsable + rename-stable.
    expect(paths).toContain(N.projBilling);
    expect(paths).toContain(`${N.tplDoc}/template.json`);
    // Source is a verbatim sidecar with a type-appropriate extension.
    expect(paths).toContain(`${N.tplDoc}/source.md`);
    expect(paths).toContain(`${N.tplCap}/source.js`);
    // api templates are a readable `request.http`, not a JSON `source.*`.
    expect(paths).toContain(`${N.tplApi}/request.http`);
    expect(paths).not.toContain(`${N.tplApi}/source.json`);
    expect(paths).toContain(`${N.tplDoc}/releases/${N.relV1}`);
    // Soft-deleted rows never reach the files.
    expect(paths.some((p) => p.startsWith('templates/obsolete.'))).toBe(false);
    expect(paths).not.toContain(N.tagDead);

    // The markdown source file holds the exact draft, unescaped.
    expect(files.get(`${N.tplDoc}/source.md`)).toBe(
      '# Release {{version}}\n\n- item one\n- item two\n',
    );

    // template.json embeds tag ids and omits the source (which lives in the sidecar).
    const tpl = JSON.parse(files.get(`${N.tplDoc}/template.json`)!);
    expect(tpl.tags).toEqual(['tag-a', 'tag-b']);
    expect(tpl).not.toHaveProperty('source');

    // The api request.http is a standard, readable file; structured auth + actions live in the
    // template.json `api` block (the parts `.http` can't carry).
    const http = files.get(`${N.tplApi}/request.http`)!;
    expect(http).toContain('POST https://api.test/u/1');
    expect(http).toContain('Accept: application/json');
    const apiTpl = JSON.parse(files.get(`${N.tplApi}/template.json`)!);
    expect(apiTpl).not.toHaveProperty('source');
    expect(apiTpl.api.auth).toEqual({ kind: 'bearer', token: "${ secret('T') }" });
    expect(apiTpl.api.actions).toEqual([{ ref: 'log', trigger: 'pre' }]);

    // Manifest carries versions + identity, never storage mode / device id.
    const manifest = JSON.parse(files.get('workspace.json')!);
    expect(manifest).toMatchObject({ name: 'Acme Ops', icon: '🚀', executionMode: 'sandbox' });
    expect(manifest).not.toHaveProperty('storageMode');
    expect(manifest).not.toHaveProperty('deviceId');
  });

  it('writes canonical JSON (keys sorted, trailing newline)', async () => {
    const a = await buildSampleWorkspace();
    const fs = new MemoryDirFs();
    await dumpWorkspace(a, fs);
    const manifest = fs.snapshot().get('workspace.json')!;
    // Sorted keys: executionMode < formatVersion < icon < name < schemaVersion.
    expect(manifest.startsWith('{\n  "executionMode":')).toBe(true);
    expect(manifest.endsWith('}\n')).toBe(true);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });

  it('removes files for entities deleted since the last dump (delete = file removal)', async () => {
    const a = await buildSampleWorkspace();
    const fs = new MemoryDirFs();
    await dumpWorkspace(a, fs);
    expect(fs.snapshot().has(N.projInfra)).toBe(true);

    await softDelete(a, 'projects', 'proj-2');
    await softDelete(a, 'templates', 'tpl-cap');
    await dumpWorkspace(a, fs);

    const paths = [...fs.snapshot().keys()];
    expect(paths).not.toContain(N.projInfra);
    expect(paths).toContain(N.projBilling);
    expect(paths.some((p) => p.startsWith(`${N.tplCap}/`))).toBe(false);
    expect(paths.some((p) => p.startsWith(`${N.tplDoc}/`))).toBe(true);
  });

  it('rewrites the source sidecar when the subtype (extension) changes', async () => {
    const a = await buildSampleWorkspace();
    const fs = new MemoryDirFs();
    await dumpWorkspace(a, fs);
    expect(fs.snapshot().has(`${N.tplDoc}/source.md`)).toBe(true);

    await a.run('UPDATE templates SET subtype = ? WHERE id = ?', ['html', 'tpl-doc']);
    await dumpWorkspace(a, fs);
    const paths = [...fs.snapshot().keys()];
    expect(paths).toContain(`${N.tplDoc}/source.html`);
    expect(paths).not.toContain(`${N.tplDoc}/source.md`);
  });

  it('moves the slug file on rename but keeps the same in-file id (hybrid naming)', async () => {
    const a = await buildSampleWorkspace();
    const fs = new MemoryDirFs();
    await dumpWorkspace(a, fs);
    expect(fs.snapshot().has(N.projBilling)).toBe(true);

    await a.run('UPDATE projects SET name = ? WHERE id = ?', ['Payments', 'proj-1']);
    await dumpWorkspace(a, fs);

    const renamed = `projects/${entityBaseName('Payments', 'proj-1')}.json`;
    const paths = [...fs.snapshot().keys()];
    expect(paths).toContain(renamed);
    expect(paths).not.toContain(N.projBilling); // old slug file removed — a pure move
    // Identity is content-based: the id inside the file never changes.
    expect(JSON.parse(fs.snapshot().get(renamed)!).id).toBe('proj-1');

    // And it still round-trips: the renamed file rehydrates to the same id.
    const b = await freshAdapter();
    await b.createSchema();
    await hydrateWorkspace(b, fs, { deviceId: 'dev-B', now: isoNow(), storageMode: 'git' });
    const proj = await b.get<{ name: string }>("SELECT name FROM projects WHERE id = 'proj-1'");
    expect(proj?.name).toBe('Payments');
  });

  it('hydrates legacy <id>.json files (path-independent loader, back-compat)', async () => {
    // An older Swaft wrote flat entities as `<id>.json`; the loader keys off the in-file id, so
    // these must still hydrate unchanged even though dump now emits `<slug>.<shortId>.json`.
    const fs = new MemoryDirFs();
    await fs.writeFile(
      'workspace.json',
      JSON.stringify({ formatVersion: 1, schemaVersion: 2, name: 'Old', executionMode: 'sandbox' }),
    );
    await fs.writeFile(
      'projects/legacy-id.json',
      JSON.stringify({ id: 'legacy-id', name: 'Legacy', color: null, description: null }),
    );

    const b = await freshAdapter();
    await b.createSchema();
    await hydrateWorkspace(b, fs, { deviceId: 'd', now: isoNow(), storageMode: 'git' });
    const proj = await b.get<{ name: string }>("SELECT name FROM projects WHERE id = 'legacy-id'");
    expect(proj?.name).toBe('Legacy');
  });

  it('rejects a folder with no manifest and a workspace from a newer schema', async () => {
    const empty = new MemoryDirFs();
    const b = await freshAdapter();
    await b.createSchema();
    await expect(
      hydrateWorkspace(b, empty, { deviceId: 'd', now: isoNow(), storageMode: 'git' }),
    ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE' });

    const newer = new MemoryDirFs();
    await newer.writeFile('workspace.json', canonicalJson({ schemaVersion: 9999, name: 'X' }));
    const c = await freshAdapter();
    await c.createSchema();
    await expect(
      hydrateWorkspace(c, newer, { deviceId: 'd', now: isoNow(), storageMode: 'git' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('maps template types to source extensions', () => {
    expect(sourceExtension('document', 'markdown')).toBe('md');
    expect(sourceExtension('document', 'sql')).toBe('sql');
    expect(sourceExtension('api', 'GET')).toBe('json');
    expect(sourceExtension('capability', null)).toBe('js');
    expect(sourceExtension('render', 'mermaid')).toBe('mmd');
    expect(sourceExtension('document', 'weird')).toBe('txt');
  });
});
