import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction } from 'ajv';
import { describe, expect, it } from 'vitest';
import { InProcessDbBackend } from '../../storage/db-backend';
import type { SqlParam } from '../../storage/sqlite';
import { LocalAdapter } from '../LocalAdapter';
import { MemoryDirFs } from './dir-fs';
import { dumpWorkspace } from './projection';

/**
 * The published JSON Schemas (FORMAT.md) are the contract for the on-disk form. This test dumps a
 * workspace that exercises every file shape and validates each emitted JSON file against its schema,
 * so schema drift (a projection change not reflected in the schemas, or vice-versa) fails loudly.
 */

const dir = fileURLToPath(new URL('./schemas', import.meta.url));
const load = (name: string): object => JSON.parse(readFileSync(`${dir}/${name}.schema.json`, 'utf8'));

const ajv = new Ajv({ allErrors: true });
const V: Record<string, ValidateFunction> = {
  workspace: ajv.compile(load('workspace')),
  settings: ajv.compile(load('settings')),
  project: ajv.compile(load('project')),
  folder: ajv.compile(load('folder')),
  tag: ajv.compile(load('tag')),
  environment: ajv.compile(load('environment')),
  changelog: ajv.compile(load('changelog')),
  template: ajv.compile(load('template')),
  release: ajv.compile(load('release')),
};

/** Which schema governs a given emitted file path (null → a non-JSON sidecar, not validated here). */
function validatorFor(path: string): ValidateFunction | null {
  if (path === 'workspace.json') return V.workspace!;
  if (path === 'settings.json') return V.settings!;
  if (path.endsWith('/template.json')) return V.template!;
  if (/\/releases\/[^/]+\.json$/.test(path)) return V.release!;
  if (path.startsWith('projects/')) return V.project!;
  if (path.startsWith('folders/')) return V.folder!;
  if (path.startsWith('tags/')) return V.tag!;
  if (path.startsWith('environments/')) return V.environment!;
  if (path.startsWith('changelog/')) return V.changelog!;
  return null; // request.http, source.*, code.js — non-JSON bodies
}

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

async function fullWorkspace(): Promise<LocalAdapter> {
  const a = new LocalAdapter(await InProcessDbBackend.open());
  await a.initialize({ name: 'Schemas WS', storageMode: 'git', executionMode: 'sandbox', deviceId: 'dev', now: isoNow() });
  await a.updateMeta({ icon: '🚀' }, 'dev', isoNow());
  await ins(a, 'workspace_settings', {
    id: 'settings',
    execution_mode: 'sandbox',
    blocked_domains: JSON.stringify(['evil.test']),
    proxy_url: null,
    enforced_headers: JSON.stringify({ 'X-Team': 'ops' }),
    batcher_enabled: 1,
  });
  await ins(a, 'projects', { id: 'p1', name: 'Billing', color: '#f80', description: 'Money' });
  await ins(a, 'folders', {
    id: 'f1',
    name: 'Calls',
    project_id: 'p1',
    parent_folder_id: null,
    headers: JSON.stringify({ 'X-Api': '2' }),
    proxy: null,
    auth: null,
    actions: JSON.stringify([{ ref: 'pre', trigger: 'before' }]),
    notes: 'notes',
  });
  await ins(a, 'tags', { id: 'tg', name: 'ops', color: null });
  await ins(a, 'environments', {
    id: 'e1',
    name: 'staging',
    description: null,
    owner_kind: 'workspace',
    owner_id: null,
    vars: JSON.stringify({ baseUrl: 'https://x' }),
  });
  await ins(a, 'templates', {
    id: 'tapi',
    folder_id: 'f1',
    project_id: null,
    name: 'Get user',
    type: 'api',
    subtype: 'GET',
    source: JSON.stringify({ method: 'GET', url: 'https://x/u', auth: { kind: 'bearer', token: 'T' }, actions: [{ ref: 'log', trigger: 'pre' }] }),
    has_draft: 1,
  });
  await ins(a, 'templates', {
    id: 'tdoc',
    folder_id: '',
    project_id: 'p1',
    name: 'Notes',
    type: 'document',
    subtype: 'markdown',
    source: '# Hi\n',
    has_draft: 1,
  });
  await ins(a, 'template_tags', { id: 'tt', template_id: 'tdoc', tag_id: 'tg' });
  await ins(a, 'releases', { id: 'r1', template_id: 'tdoc', version: 1, name: 'v1', subtype: 'markdown', source: '# v1\n' });
  await ins(a, 'changelog', { id: 'c1', entity_type: 'template', entity_id: 'tdoc', message: 'Created', username: 'alice' });
  return a;
}

describe('on-disk JSON Schemas (FORMAT.md)', () => {
  it('validates every emitted JSON file against its published schema', async () => {
    const a = await fullWorkspace();
    const fs = new MemoryDirFs();
    await dumpWorkspace(a, fs);

    const failures: string[] = [];
    let jsonFiles = 0;
    for (const [path, content] of fs.snapshot()) {
      const validate = validatorFor(path);
      if (!validate) continue;
      jsonFiles++;
      if (!validate(JSON.parse(content))) {
        failures.push(`${path}: ${ajv.errorsText(validate.errors)}`);
      }
    }

    expect(failures).toEqual([]);
    // Sanity: we actually exercised a representative spread of shapes.
    expect(jsonFiles).toBeGreaterThanOrEqual(9);
    await a.close();
  });

  it('rejects a file that violates its schema (the guard works)', () => {
    // A project with a numeric name must fail — proving the validators aren't vacuous.
    expect(V.project!({ id: 'x', name: 123, color: null, description: null })).toBe(false);
    // An unknown property is rejected (additionalProperties: false catches drift).
    expect(V.tag!({ id: 'x', name: 'y', color: null, extra: true })).toBe(false);
  });
});
