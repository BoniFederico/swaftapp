import { randomUUID } from 'node:crypto';
import type { StorageMode } from '@swaft/shared';
import { AppError } from '../../errors';
import type { SqlParam } from '../../storage/sqlite';
import { SCHEMA_VERSION } from '../../storage/schema';
import { parseJsonOr } from '../../util/json';
import type { LocalAdapter } from '../LocalAdapter';
import { canonicalJson } from './canonical-json';
import type { DirFs } from './dir-fs';

/**
 * Projects the 🟢 synchronized tables of the in-memory SQLite working store to and from a directory
 * of plain, readable files — the on-disk form of a `git` workspace. This is the
 * correctness core of the Git mode: `dumpWorkspace` writes the DB out, `hydrateWorkspace` rebuilds a
 * fresh DB from the files, and the two are exact inverses at the domain level.
 *
 * What is deliberately NOT round-tripped through the files (regenerated on hydrate instead):
 *  - **sync-metadata** (`created_at`, `updated_at`, `updated_by_device_id`, `revision`, `deleted_at`) —
 *    Git provides history and merge, so committing these would only add churn and conflicts;
 *  - **`workspace_meta.storage_mode` / `device_id`** — environment-supplied, not versioned;
 *  - **🔵 local-only tables** (history, run logs, input state, selections) — never versioned.
 *
 * Soft-deleted rows are skipped on dump and their files removed, so a delete surfaces as a file
 * removal. JSON-config columns are inlined as real nested JSON (readable, compared semantically);
 * a template's editable `source` is written verbatim to a sidecar file with a type-appropriate
 * extension so diffs are meaningful.
 */

/** On-disk layout/format version, stamped in `workspace.json`. Bumped when the file shapes change. */
export const FORMAT_VERSION = 1;

const MANIFEST_FILE = 'workspace.json';
const SETTINGS_FILE = 'settings.json';
const WORKSPACE_META_ID = 'workspace';

/** Context needed to regenerate the non-versioned fields when rebuilding the DB from files. */
export interface HydrateContext {
  deviceId: string;
  /** ISO-8601 timestamp stamped as created_at/updated_at on every rehydrated row. */
  now: string;
  /** Storage mode written into `workspace_meta` (the manifest does not carry it). */
  storageMode: StorageMode;
}

/** A 🟢 collection table stored as one file per row under `dir/<id>.json`. */
interface FlatEntity {
  table: string;
  dir: string;
  /** Domain columns (everything except sync-metadata), including `id`. */
  columns: readonly string[];
  /** Columns holding a JSON string: inlined as nested JSON in the file (null-preserving). */
  json?: readonly string[];
  /** Columns holding 0/1: represented as booleans in the file. */
  bool?: readonly string[];
}

const FLAT_ENTITIES: readonly FlatEntity[] = [
  { table: 'projects', dir: 'projects', columns: ['id', 'name', 'color', 'description'] },
  {
    table: 'folders',
    dir: 'folders',
    columns: [
      'id',
      'name',
      'project_id',
      'parent_folder_id',
      'headers',
      'proxy',
      'auth',
      'actions',
      'notes',
    ],
    json: ['headers', 'proxy', 'auth', 'actions'],
  },
  { table: 'tags', dir: 'tags', columns: ['id', 'name', 'color'] },
  {
    table: 'environments',
    dir: 'environments',
    columns: ['id', 'name', 'description', 'owner_kind', 'owner_id', 'vars'],
    json: ['vars'],
  },
  {
    table: 'changelog',
    dir: 'changelog',
    columns: ['id', 'entity_type', 'entity_id', 'message', 'username'],
  },
];

const SETTINGS_ENTITY: FlatEntity = {
  table: 'workspace_settings',
  dir: '',
  columns: [
    'id',
    'execution_mode',
    'blocked_domains',
    'proxy_url',
    'enforced_headers',
    'batcher_enabled',
  ],
  json: ['blocked_domains', 'enforced_headers'],
  bool: ['batcher_enabled'],
};

const SYNC_META_FOR_INSERT = (ctx: HydrateContext): Record<string, SqlParam> => ({
  created_at: ctx.now,
  updated_at: ctx.now,
  updated_by_device_id: ctx.deviceId,
  revision: 1,
  deleted_at: null,
});

// --- Public API -------------------------------------------------------------

/** Write the open workspace's synchronized entities to `fs` as a directory of readable files. */
export async function dumpWorkspace(adapter: LocalAdapter, fs: DirFs): Promise<void> {
  await dumpManifest(adapter, fs);
  await dumpSettings(adapter, fs);
  for (const entity of FLAT_ENTITIES) await dumpFlat(adapter, fs, entity);
  await dumpTemplates(adapter, fs);
}

/**
 * Rebuild the synchronized entities into a fresh, schema-created (but empty) `adapter` from the files
 * in `fs`. The caller must have run {@link LocalAdapter.createSchema} first.
 */
export async function hydrateWorkspace(
  adapter: LocalAdapter,
  fs: DirFs,
  ctx: HydrateContext,
): Promise<void> {
  await hydrateManifest(adapter, fs, ctx);
  await hydrateSettings(adapter, fs, ctx);
  for (const entity of FLAT_ENTITIES) await hydrateFlat(adapter, fs, entity, ctx);
  await hydrateTemplates(adapter, fs, ctx);
}

// --- Manifest (workspace_meta) ---------------------------------------------

async function dumpManifest(adapter: LocalAdapter, fs: DirFs): Promise<void> {
  const meta = await adapter.getMeta();
  if (!meta) throw new AppError('INVALID_WORKSPACE', 'validation', 'Workspace metadata is missing.');
  await fs.writeFile(
    MANIFEST_FILE,
    canonicalJson({
      formatVersion: FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      name: meta.name,
      icon: meta.icon,
      executionMode: meta.execution_mode,
    }),
  );
}

async function hydrateManifest(adapter: LocalAdapter, fs: DirFs, ctx: HydrateContext): Promise<void> {
  const raw = await fs.readFile(MANIFEST_FILE);
  if (raw == null) {
    throw new AppError('INVALID_WORKSPACE', 'validation', 'The folder is not a Swaft workspace.');
  }
  const manifest = parseJsonOr<Record<string, unknown>>(raw, {});
  const fileSchema = Number(manifest.schemaVersion);
  if (Number.isFinite(fileSchema) && fileSchema > SCHEMA_VERSION) {
    throw new AppError(
      'SCHEMA_TOO_NEW',
      'validation',
      `This workspace was created by a newer version of Swaft (schema v${fileSchema} > v${SCHEMA_VERSION}). Please update Swaft.`,
      { fileVersion: fileSchema, supportedVersion: SCHEMA_VERSION },
    );
  }
  await insertRow(adapter, 'workspace_meta', {
    id: WORKSPACE_META_ID,
    name: String(manifest.name ?? ''),
    icon: (manifest.icon as string | null) ?? null,
    storage_mode: ctx.storageMode,
    execution_mode: String(manifest.executionMode ?? 'sandbox'),
    device_id: ctx.deviceId,
    ...SYNC_META_FOR_INSERT(ctx),
  });
}

// --- Settings (singleton file) ---------------------------------------------

async function dumpSettings(adapter: LocalAdapter, fs: DirFs): Promise<void> {
  const row = await adapter.get<Record<string, SqlParam>>(
    'SELECT * FROM workspace_settings WHERE deleted_at IS NULL',
  );
  if (!row) {
    await fs.remove(SETTINGS_FILE);
    return;
  }
  await fs.writeFile(SETTINGS_FILE, canonicalJson(rowToDomain(row, SETTINGS_ENTITY)));
}

async function hydrateSettings(adapter: LocalAdapter, fs: DirFs, ctx: HydrateContext): Promise<void> {
  const raw = await fs.readFile(SETTINGS_FILE);
  if (raw == null) return;
  const domain = parseJsonOr<Record<string, unknown>>(raw, {});
  await insertRow(adapter, SETTINGS_ENTITY.table, {
    ...domainToRow(domain, SETTINGS_ENTITY),
    ...SYNC_META_FOR_INSERT(ctx),
  });
}

// --- Flat collections -------------------------------------------------------

async function dumpFlat(adapter: LocalAdapter, fs: DirFs, entity: FlatEntity): Promise<void> {
  const rows = await adapter.all<Record<string, SqlParam>>(
    `SELECT * FROM ${entity.table} WHERE deleted_at IS NULL`,
  );
  const kept = new Set<string>();
  for (const row of rows) {
    const id = String(row.id);
    kept.add(id);
    await fs.writeFile(`${entity.dir}/${id}.json`, canonicalJson(rowToDomain(row, entity)));
  }
  await removeStaleJson(fs, entity.dir, kept);
}

async function hydrateFlat(
  adapter: LocalAdapter,
  fs: DirFs,
  entity: FlatEntity,
  ctx: HydrateContext,
): Promise<void> {
  for (const name of await fs.list(entity.dir)) {
    if (!name.endsWith('.json')) continue;
    const raw = await fs.readFile(`${entity.dir}/${name}`);
    if (raw == null) continue;
    const domain = parseJsonOr<Record<string, unknown>>(raw, {});
    await insertRow(adapter, entity.table, {
      ...domainToRow(domain, entity),
      ...SYNC_META_FOR_INSERT(ctx),
    });
  }
}

// --- Templates (nested: source sidecar + embedded tags + releases) ----------

async function dumpTemplates(adapter: LocalAdapter, fs: DirFs): Promise<void> {
  const templates = await adapter.all<Record<string, SqlParam>>(
    'SELECT * FROM templates WHERE deleted_at IS NULL',
  );
  const kept = new Set<string>();
  for (const t of templates) {
    const id = String(t.id);
    kept.add(id);
    const dir = `templates/${id}`;

    // Editable source → verbatim sidecar with a type-appropriate extension (meaningful diffs).
    const ext = sourceExtension(String(t.type), t.subtype == null ? null : String(t.subtype));
    const sourceFile = `source.${ext}`;
    await fs.writeFile(`${dir}/${sourceFile}`, String(t.source ?? ''));
    await removeOtherSources(fs, dir, sourceFile);

    const tagRows = await adapter.all<{ tag_id: string }>(
      'SELECT tag_id FROM template_tags WHERE template_id = ? AND deleted_at IS NULL ORDER BY tag_id',
      [id],
    );
    await fs.writeFile(
      `${dir}/template.json`,
      canonicalJson({
        id,
        folderId: t.folder_id ?? '',
        projectId: t.project_id ?? null,
        name: t.name,
        type: t.type,
        subtype: t.subtype ?? null,
        hasDraft: Number(t.has_draft) !== 0,
        tags: tagRows.map((r) => r.tag_id),
      }),
    );

    const releases = await adapter.all<Record<string, SqlParam>>(
      'SELECT * FROM releases WHERE template_id = ? AND deleted_at IS NULL',
      [id],
    );
    const keptReleases = new Set<string>();
    for (const r of releases) {
      const rid = String(r.id);
      keptReleases.add(rid);
      await fs.writeFile(
        `${dir}/releases/${rid}.json`,
        canonicalJson({
          id: rid,
          templateId: r.template_id,
          version: r.version,
          name: r.name ?? '',
          subtype: r.subtype ?? null,
          source: r.source ?? '',
        }),
      );
    }
    await removeStaleJson(fs, `${dir}/releases`, keptReleases);
  }

  // Remove whole template directories that no longer correspond to a live template.
  for (const name of await fs.list('templates')) {
    if (!kept.has(name)) await fs.remove(`templates/${name}`);
  }
}

async function hydrateTemplates(
  adapter: LocalAdapter,
  fs: DirFs,
  ctx: HydrateContext,
): Promise<void> {
  for (const id of await fs.list('templates')) {
    const dir = `templates/${id}`;
    const rawTemplate = await fs.readFile(`${dir}/template.json`);
    if (rawTemplate == null) continue;
    const t = parseJsonOr<Record<string, unknown>>(rawTemplate, {});

    const entries = await fs.list(dir);
    const sourceName = entries.find((e) => e.startsWith('source.'));
    const source = sourceName ? ((await fs.readFile(`${dir}/${sourceName}`)) ?? '') : '';

    await insertRow(adapter, 'templates', {
      id: String(t.id ?? id),
      folder_id: (t.folderId as string | undefined) ?? '',
      project_id: (t.projectId as string | null) ?? null,
      name: String(t.name ?? ''),
      type: String(t.type ?? ''),
      subtype: (t.subtype as string | null) ?? null,
      source,
      has_draft: t.hasDraft ? 1 : 0,
      ...SYNC_META_FOR_INSERT(ctx),
    });

    for (const tagId of Array.isArray(t.tags) ? (t.tags as unknown[]) : []) {
      await insertRow(adapter, 'template_tags', {
        id: randomUUID(),
        template_id: String(t.id ?? id),
        tag_id: String(tagId),
        ...SYNC_META_FOR_INSERT(ctx),
      });
    }

    for (const name of await fs.list(`${dir}/releases`)) {
      if (!name.endsWith('.json')) continue;
      const rawRelease = await fs.readFile(`${dir}/releases/${name}`);
      if (rawRelease == null) continue;
      const r = parseJsonOr<Record<string, unknown>>(rawRelease, {});
      await insertRow(adapter, 'releases', {
        id: String(r.id ?? ''),
        template_id: String(r.templateId ?? t.id ?? id),
        version: Number(r.version ?? 0),
        name: String(r.name ?? ''),
        subtype: (r.subtype as string | null) ?? null,
        source: String(r.source ?? ''),
        ...SYNC_META_FOR_INSERT(ctx),
      });
    }
  }
}

// --- Row <-> domain mapping --------------------------------------------------

/** Map a DB row to its file (domain) shape: camelCase keys, JSON columns inlined, 0/1 → boolean. */
function rowToDomain(row: Record<string, SqlParam>, entity: FlatEntity): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of entity.columns) {
    const key = toCamel(col);
    const raw = row[col];
    if (entity.json?.includes(col)) {
      out[key] = raw == null ? null : parseJsonOr<unknown>(String(raw), null);
    } else if (entity.bool?.includes(col)) {
      out[key] = Number(raw) !== 0;
    } else {
      out[key] = raw ?? null;
    }
  }
  return out;
}

/** Inverse of {@link rowToDomain}: file (domain) shape → DB row columns (no sync-metadata). */
function domainToRow(domain: Record<string, unknown>, entity: FlatEntity): Record<string, SqlParam> {
  const out: Record<string, SqlParam> = {};
  for (const col of entity.columns) {
    const value = domain[toCamel(col)];
    if (entity.json?.includes(col)) {
      out[col] = value == null ? null : JSON.stringify(value);
    } else if (entity.bool?.includes(col)) {
      out[col] = value ? 1 : 0;
    } else {
      out[col] = (value ?? null) as SqlParam;
    }
  }
  return out;
}

// --- Helpers -----------------------------------------------------------------

async function insertRow(
  adapter: LocalAdapter,
  table: string,
  row: Record<string, SqlParam>,
): Promise<void> {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  await adapter.run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
    cols.map((c) => row[c]),
  );
}

/** Remove `dir/<id>.json` files whose id is not in `kept`. */
async function removeStaleJson(fs: DirFs, dir: string, kept: Set<string>): Promise<void> {
  for (const name of await fs.list(dir)) {
    if (name.endsWith('.json') && !kept.has(name.slice(0, -'.json'.length))) {
      await fs.remove(`${dir}/${name}`);
    }
  }
}

/** Remove any `source.*` sidecar in `dir` other than `keep` (e.g. after a subtype/extension change). */
async function removeOtherSources(fs: DirFs, dir: string, keep: string): Promise<void> {
  for (const name of await fs.list(dir)) {
    if (name.startsWith('source.') && name !== keep) await fs.remove(`${dir}/${name}`);
  }
}

const SUBTYPE_EXTENSIONS: Record<string, string> = {
  markdown: 'md',
  md: 'md',
  html: 'html',
  eml: 'eml',
  csv: 'csv',
  json: 'json',
  'json-preview': 'json',
  xml: 'xml',
  yaml: 'yaml',
  txt: 'txt',
  plain: 'txt',
  javascript: 'js',
  python: 'py',
  sql: 'sql',
  mermaid: 'mmd',
  echarts: 'json',
  swagger: 'yaml',
  openapi: 'yaml',
};

/** File extension for a template's `source` sidecar — cosmetic (content is written verbatim). */
export function sourceExtension(type: string, subtype: string | null): string {
  if (type === 'api' || type === 'scenario') return 'json';
  if (type === 'capability' || type === 'action') return 'js';
  return (subtype && SUBTYPE_EXTENSIONS[subtype]) || 'txt';
}

const toCamel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
