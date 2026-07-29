import { randomUUID } from 'node:crypto';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import {
  fromArazzo,
  fromHttpFile,
  parseFrontMatter,
  parseScenarioGraph,
  scanForSecrets,
  serializeScenarioGraph,
  toArazzo,
  toFrontMatter,
  toHttpFile,
  type HttpRequestModel,
  type SecretFinding,
  type StorageMode,
} from '@swaft/shared';
import { AppError } from '../../errors';
import type { SqlParam } from '../../storage/sqlite';
import { SCHEMA_VERSION } from '../../storage/schema';
import { parseJsonOr } from '../../util/json';
import type { LocalAdapter } from '../LocalAdapter';
import { canonicalJson } from './canonical-json';
import { MemoryDirFs, type DirFs } from './dir-fs';
import { entityBaseName, shortId } from './naming';

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

/** On-disk layout/format version, stamped in `workspace.json`. Bumped when the file shapes change.
 *  v2: `api` templates are stored as a readable `request.http` file (open-standards plan §5) plus an
 *  `api` block in `template.json` for the parts `.http` can't carry (structured auth, pre/post
 *  actions). v1 workspaces (an `api` source in `source.json`) still open — hydrate reads whichever
 *  form is present, and the next save rewrites to v2.
 *  v3: `scenario` templates are stored as a readable `scenario.arazzo.yaml` file (open-standards plan
 *  §7 / D6) — an Arazzo 1.0 workflow document, with everything Arazzo has no native concept for
 *  (action/capability/delay nodes, decision branches, canvas layout) under `x-swaft` extensions. v1/v2
 *  workspaces (a scenario graph in `source.json`) still open — hydrate reads whichever form is
 *  present, and the next save rewrites to v3.
 *  v4: `document` templates' `source.<ext>` body gets a YAML **front-matter** header
 *  (id/name/type/subtype/tags, open-standards plan §8 / C2) prepended, so the file is self-describing
 *  when opened directly by another tool. `template.json` stays the source of truth; the header is a
 *  write-only mirror, tolerantly stripped back out on hydrate. Older files with no header still open
 *  unchanged (front matter is optional, not version-gated on read).
 *  v5: each `environments/<slug>.<id>.json` gets a companion `environments/<slug>.<id>.env` dotenv
 *  file (open-standards plan §3.3 item 2) — a hand-editable, portable mirror for tools that read plain
 *  `KEY=value` files. The JSON file stays the sole source of truth; the `.env` is regenerated on every
 *  save and never read back on hydrate (so hand edits to it are silently overwritten, same tradeoff as
 *  the front-matter header). Secret-labeled vars (§3.3 item 1) are never written to it — only listed by
 *  name in a trailing comment — so it carries no more risk than the JSON it mirrors. */
export const FORMAT_VERSION = 5;

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

/** A 🟢 collection table stored as one file per row under `dir/<slug>.<shortId>.json`. */
interface FlatEntity {
  table: string;
  dir: string;
  /** Domain columns (everything except sync-metadata), including `id`. */
  columns: readonly string[];
  /** Columns holding a JSON string: inlined as nested JSON in the file (null-preserving). */
  json?: readonly string[];
  /** Columns holding 0/1: represented as booleans in the file. */
  bool?: readonly string[];
  /** Column whose value seeds the readable file-name slug. Defaults to `name`. */
  nameColumn?: string;
  /**
   * Fallback for a column added to this table *after* older files were written, so a file missing the
   * key entirely (rather than carrying it as `null`/`false`) still satisfies a `NOT NULL DEFAULT`
   * column instead of hydrating a literal `NULL` (or, for a `bool` column, a wrong `0`) into it. Only
   * applies when the key is absent — a key explicitly present with value `null` still round-trips as
   * `null` (for genuinely nullable `json` columns). Keyed by column name; value is the raw domain-shape
   * default (an object/array for a `json` column, a boolean for a `bool` column, the literal string for
   * a plain column) — mirrors the column's own SQL `DEFAULT`.
   */
  defaults?: Readonly<Record<string, unknown>>;
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
    // `headers`/`actions`/`notes` were added to this table well after folders existed (v21/v24); a
    // file predating one of them has no such key at all. `proxy`/`auth` are genuinely nullable, so
    // they're deliberately not defaulted here — an absent key there still hydrates as `null`.
    defaults: { headers: {}, actions: [], notes: '' },
  },
  { table: 'tags', dir: 'tags', columns: ['id', 'name', 'color'] },
  {
    table: 'environments',
    dir: 'environments',
    columns: ['id', 'name', 'description', 'owner_kind', 'owner_id', 'vars', 'secret_vars'],
    json: ['vars', 'secret_vars'],
    // A file written before `secretVars` existed has no such key at all (not `null`) — default it to
    // an empty array rather than hydrating NULL into the NOT NULL `secret_vars` column.
    defaults: { secret_vars: [] },
  },
  {
    table: 'changelog',
    dir: 'changelog',
    columns: ['id', 'entity_type', 'entity_id', 'message', 'username'],
    // Changelog rows have no `name`; seed the slug from the entity type (`template.<id>`).
    nameColumn: 'entity_type',
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
  // `batcher_enabled` was added at v22; a settings.json predating it has no such key. Without a
  // default, an absent bool key reads as falsy → the batcher would be silently disabled for every
  // pre-v22 workspace instead of keeping the column's own DEFAULT 1 (enabled).
  defaults: { batcher_enabled: true },
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
  await dumpEnvironmentDotenv(adapter, fs);
  await dumpTemplates(adapter, fs);
}

/** Quote a dotenv value when it needs it (whitespace, `#`, quotes, or a newline), escaping `\` and `"`. */
function dotenvValue(v: string): string {
  if (!/[\s#"'\\]/.test(v)) return v;
  return `"${v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`;
}

/**
 * Write a `environments/<slug>.<id>.env` companion per environment (open-standards §3.3 item 2) — a
 * hand-editable, portable dotenv mirror of the JSON file's `vars`. Write-only: never read back on
 * hydrate, so the JSON stays the single source of truth. Secret-labeled vars (§3.3 item 1) are left
 * out of the file entirely (only named in a trailing comment), matching the export redaction already
 * applied to Postman/Bruno bundles (§3.6) — a `.env` file is exactly the kind of thing that gets
 * committed or copied around, so it must never carry a literal secret value.
 */
async function dumpEnvironmentDotenv(adapter: LocalAdapter, fs: DirFs): Promise<void> {
  const rows = await adapter.all<Record<string, SqlParam>>(
    'SELECT * FROM environments WHERE deleted_at IS NULL',
  );
  const kept = new Set<string>();
  for (const row of rows) {
    const file = `${entityBaseName(String(row.name ?? ''), String(row.id))}.env`;
    kept.add(file);
    const vars = parseJsonOr<Record<string, string>>(String(row.vars ?? '{}'), {});
    const secret = new Set(parseJsonOr<string[]>(String(row.secret_vars ?? '[]'), []));
    const lines = [
      `# Swaft environment "${row.name}" (${row.owner_kind}) — generated from the .json file, not read back on open.`,
      ...Object.entries(vars)
        .filter(([k]) => !secret.has(k))
        .map(([k, v]) => `${k}=${dotenvValue(v)}`),
    ];
    const secretKeys = Object.keys(vars).filter((k) => secret.has(k));
    if (secretKeys.length > 0) lines.push(`# secret-labeled (omitted): ${secretKeys.join(', ')}`);
    await fs.writeFile(`environments/${file}`, `${lines.join('\n')}\n`);
  }
  for (const name of await fs.list('environments')) {
    if (name.endsWith('.env') && !kept.has(name)) await fs.remove(`environments/${name}`);
  }
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

/** A probable-secret finding in one on-disk file (open-standards §3.4). */
export interface WorkspaceSecretFinding {
  /** File path the finding is in, relative to the workspace root. */
  path: string;
  findings: SecretFinding[];
}

const SCANNABLE_PATH = /^(?:templates\/[^/]+\/request\.http|folders\/.+\.json)$/;

/**
 * Scan the files {@link dumpWorkspace} would write for probable secret literals — a pre-commit gate
 * (git.commit) that never touches the real filesystem: it dumps into a throwaway {@link MemoryDirFs}
 * and scans that. Limited to files where a literal secret is plausible and meaningful to flag: api
 * request bodies (`request.http`, headers/auth/body) and folder-propagated policy (`headers`/`auth`).
 * Environment variables are scanned too, but a variable already labeled `secret` (§3.3) is an
 * acknowledged risk and excluded — re-flagging it would just be noise the user already dismissed.
 * Documents/scenarios/capabilities are not scanned: free-form text triggers far more false positives
 * (long ids, hashes, base64) with no correspondingly higher chance of a real secret.
 */
export async function scanWorkspaceForSecrets(adapter: LocalAdapter): Promise<WorkspaceSecretFinding[]> {
  const fs = new MemoryDirFs();
  await dumpWorkspace(adapter, fs);
  const out: WorkspaceSecretFinding[] = [];
  for (const [path, content] of fs.snapshot()) {
    let text: string;
    if (/^environments\/.+\.json$/.test(path)) {
      const env = parseJsonOr<{ vars?: Record<string, string>; secretVars?: string[] }>(content, {});
      const secret = new Set(env.secretVars ?? []);
      const configVars = Object.fromEntries(
        Object.entries(env.vars ?? {}).filter(([k]) => !secret.has(k)),
      );
      text = JSON.stringify(configVars);
    } else if (SCANNABLE_PATH.test(path)) {
      text = content;
    } else {
      continue;
    }
    const findings = scanForSecrets(text);
    if (findings.length > 0) out.push({ path, findings });
  }
  return out;
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
    // Hybrid naming (D2): `<slug>.<shortId>.json` — browsable + rename-stable. The canonical id
    // lives inside the file, so hydrate keys off the content, never the path.
    const label = row[entity.nameColumn ?? 'name'];
    const file = `${entityBaseName(label == null ? '' : String(label), String(row.id))}.json`;
    kept.add(file);
    await fs.writeFile(`${entity.dir}/${file}`, canonicalJson(rowToDomain(row, entity)));
  }
  await removeStaleFiles(fs, entity.dir, kept);
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
  // Only needed for a document's front-matter `tags` (human-readable names, not ids); fetched once
  // regardless of whether any document templates exist.
  const tagNameById = new Map(
    (
      await adapter.all<{ id: string; name: string }>('SELECT id, name FROM tags WHERE deleted_at IS NULL')
    ).map((r) => [r.id, r.name]),
  );
  const kept = new Set<string>();
  for (const t of templates) {
    const id = String(t.id);
    // Hybrid naming (D2): the template dir is `<slug>.<shortId>`; the canonical id is inside
    // template.json, so hydrate ignores the dir name.
    const dirName = entityBaseName(String(t.name ?? ''), id);
    kept.add(dirName);
    const dir = `templates/${dirName}`;

    const tagRows = await adapter.all<{ tag_id: string }>(
      'SELECT tag_id FROM template_tags WHERE template_id = ? AND deleted_at IS NULL ORDER BY tag_id',
      [id],
    );

    // Editable source → a readable sidecar. `api` templates use a standard **`request.http`** (open
    // format) plus an `api` block in `template.json` for the parts `.http` can't carry (structured
    // auth, pre/post actions); `scenario` templates use an **Arazzo 1.0** workflow document
    // (`scenario.arazzo.yaml`), with Swaft-only constructs under `x-swaft` extensions; `document`
    // templates get a YAML **front-matter** header (id/name/type/subtype/tags) prepended to the body,
    // so the file is self-describing when opened directly by another tool (Jekyll/Hugo/Obsidian all
    // read this convention); other types write a verbatim `source.<ext>` sidecar with a
    // type-appropriate extension. Meaningful diffs either way.
    let bodyFile: string;
    let apiMeta: { auth?: unknown; actions?: unknown } | undefined;
    if (String(t.type) === 'api') {
      const model = parseJsonOr<HttpRequestModel>(String(t.source ?? ''), { method: 'GET', url: '' });
      bodyFile = 'request.http';
      await fs.writeFile(`${dir}/${bodyFile}`, toHttpFile(model));
      const meta: { auth?: unknown; actions?: unknown } = {};
      if (model.auth) meta.auth = model.auth;
      if (model.actions && model.actions.length > 0) meta.actions = model.actions;
      if (Object.keys(meta).length > 0) apiMeta = meta;
    } else if (String(t.type) === 'scenario') {
      const { graph } = parseScenarioGraph(String(t.source ?? ''));
      bodyFile = 'scenario.arazzo.yaml';
      const doc = toArazzo(String(t.name ?? ''), graph);
      await fs.writeFile(`${dir}/${bodyFile}`, dumpYaml(doc, { noRefs: true, lineWidth: 100 }));
    } else {
      const ext = sourceExtension(String(t.type), t.subtype == null ? null : String(t.subtype));
      bodyFile = `source.${ext}`;
      const body = String(t.source ?? '');
      if (String(t.type) === 'document') {
        await fs.writeFile(
          `${dir}/${bodyFile}`,
          toFrontMatter(
            {
              swaftId: id,
              name: String(t.name ?? ''),
              type: 'document',
              subtype: t.subtype == null ? undefined : String(t.subtype),
              tags: tagRows.map((r) => tagNameById.get(r.tag_id) ?? r.tag_id),
            },
            body,
          ),
        );
      } else {
        await fs.writeFile(`${dir}/${bodyFile}`, body);
      }
    }
    await removeOtherBodyFiles(fs, dir, bodyFile);

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
        ...(apiMeta ? { api: apiMeta } : {}),
      }),
    );

    const releases = await adapter.all<Record<string, SqlParam>>(
      'SELECT * FROM releases WHERE template_id = ? AND deleted_at IS NULL',
      [id],
    );
    const keptReleases = new Set<string>();
    for (const r of releases) {
      const rid = String(r.id);
      // Releases are named by their (immutable) version + short id: `v3.<shortId>.json`.
      const relFile = `v${String(r.version)}.${shortId(rid)}.json`;
      keptReleases.add(relFile);
      await fs.writeFile(
        `${dir}/releases/${relFile}`,
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
    await removeStaleFiles(fs, `${dir}/releases`, keptReleases);
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
    let source: string;
    if (String(t.type) === 'api' && entries.includes('request.http')) {
      // v2 open format: reconstruct the request model from request.http + the template.json `api` block.
      const core = fromHttpFile((await fs.readFile(`${dir}/request.http`)) ?? '');
      const model: HttpRequestModel = { ...core };
      const api = t.api as { auth?: unknown; actions?: unknown } | undefined;
      if (api?.auth) (model as { auth?: unknown }).auth = api.auth;
      if (api?.actions) (model as { actions?: unknown }).actions = api.actions;
      source = JSON.stringify(model);
    } else if (String(t.type) === 'scenario' && entries.includes('scenario.arazzo.yaml')) {
      // v3 open format: reconstruct the scenario graph from the Arazzo workflow document.
      const yamlText = (await fs.readFile(`${dir}/scenario.arazzo.yaml`)) ?? '';
      let doc: unknown = null;
      try {
        doc = loadYaml(yamlText);
      } catch {
        doc = null;
      }
      source = serializeScenarioGraph(fromArazzo(doc).graph);
    } else {
      // v1/v2/v3 (or non-scenario/api): read the verbatim `source.<ext>` sidecar. `document` bodies
      // carry a front-matter header (v4) written for external-tool portability — `template.json` stays
      // the source of truth for id/name/subtype/tags, so the parsed meta is discarded here and only
      // the body is kept as `source`. Tolerant: a file with no (or a malformed) front-matter block —
      // e.g. one written before v4 — degrades to treating the whole file as body content.
      const sourceName = entries.find((e) => e.startsWith('source.'));
      const raw = sourceName ? ((await fs.readFile(`${dir}/${sourceName}`)) ?? '') : '';
      source = String(t.type) === 'document' ? parseFrontMatter(raw).body : raw;
    }

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
    const key = toCamel(col);
    const absent = !(key in domain);
    const hasDefault = !!entity.defaults && col in entity.defaults;
    if (entity.json?.includes(col)) {
      if (absent && hasDefault) {
        out[col] = JSON.stringify(entity.defaults![col]);
      } else {
        const value = domain[key];
        out[col] = value == null ? null : JSON.stringify(value);
      }
    } else if (entity.bool?.includes(col)) {
      const value = absent && hasDefault ? entity.defaults![col] : domain[key];
      out[col] = value ? 1 : 0;
    } else {
      out[col] = (absent && hasDefault ? entity.defaults![col] : (domain[key] ?? null)) as SqlParam;
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

/**
 * Remove `.json` files in `dir` whose **filename** is not in `kept`. Matching on the full written
 * name (not a parsed id) makes removal robust to hybrid renames: a slug change writes a new
 * `<slug>.<shortId>.json` and drops the old one, and a stale legacy `<id>.json` is cleaned up too.
 */
async function removeStaleFiles(fs: DirFs, dir: string, kept: Set<string>): Promise<void> {
  for (const name of await fs.list(dir)) {
    if (name.endsWith('.json') && !kept.has(name)) {
      await fs.remove(`${dir}/${name}`);
    }
  }
}

/**
 * Remove any body sidecar in `dir` other than `keep` — a `source.*` file, the api `request.http`, or
 * the scenario `scenario.arazzo.yaml`. Covers a subtype/extension change and a type change (e.g.
 * api ⇄ document swaps the body file kind).
 */
async function removeOtherBodyFiles(fs: DirFs, dir: string, keep: string): Promise<void> {
  for (const name of await fs.list(dir)) {
    const isBody =
      name.startsWith('source.') || name === 'request.http' || name === 'scenario.arazzo.yaml';
    if (isBody && name !== keep) await fs.remove(`${dir}/${name}`);
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
